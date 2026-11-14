"""Live sync across two devices, over a real socket: one device's write reaches another device's
``/events/changes`` subscription, stamped with the revision the write reached."""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable
from typing import Any

import httpx
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore

from tests.server.integration.live_stream import follow as _follow

ROOT_ASPECT = 1
Start = Callable[..., ArleshServer]


def _subscribe(base: str, token: str) -> tuple[queue.Queue[dict[str, Any]], threading.Event]:
    """Follows ``/events/changes`` as a device; each ``board-changed``'s data lands on the queue."""
    stream = _follow(base, token)
    return stream.changes, stream.connected


def _add_task(base: str, token: str, title: str) -> httpx.Response:
    written = httpx.post(
        f"{base}/tasks",
        json={"title": title, "parent_type": "domain", "parent_id": ROOT_ASPECT},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert written.status_code == 201, written.text
    return written


def test_one_devices_write_reaches_another_devices_event_stream(
    live: str, tokens: DatabaseTokenStore
) -> None:
    desktop = tokens.add("desktop")
    phone = tokens.add("phone")
    heard, connected = _subscribe(live, desktop)
    assert connected.wait(20)
    held = httpx.get(
        f"{live}/board",
        params={"now": "2026-01-01T00:00:00"},
        headers={"Authorization": f"Bearer {desktop}"},
    )
    revision = int(held.headers["x-arlesh-revision"])

    written = httpx.post(
        f"{live}/tasks",
        json={"title": "From the phone", "parent_type": "domain", "parent_id": ROOT_ASPECT},
        headers={"Authorization": f"Bearer {phone}"},
    )
    assert written.status_code == 201, written.text

    event = heard.get(timeout=10)
    assert event["epoch"] == held.headers["x-arlesh-epoch"]
    assert event["revision"] > revision


def test_a_write_reaches_the_stream_as_changed_nodes(live: str, tokens: DatabaseTokenStore) -> None:
    desktop = tokens.add("desktop")
    phone = tokens.add("phone")
    stream = _follow(live, desktop)
    assert stream.connected.wait(20)
    head = stream.heads.get(timeout=10)

    written = _add_task(live, phone, "From the phone").json()
    event = stream.next_change()

    assert event["seq"] == head["seq"] + 1
    assert event["epoch"] == head["epoch"]
    assert "reload" not in event
    entries = dict(event["changes"]["tasks"]["set"])
    assert entries[f"task-{written['id']}"]["title"] == "From the phone"
    assert isinstance(event["hash"], int) and event["now"]
    assert stream.ids[-1] == f"{event['epoch']}:{event['seq']}"


def test_two_writes_one_after_the_other_arrive_in_order_with_consecutive_sequence_numbers(
    live: str, tokens: DatabaseTokenStore
) -> None:
    desktop = tokens.add("desktop")
    phone = tokens.add("phone")
    stream = _follow(live, desktop)
    assert stream.connected.wait(20)

    _add_task(live, phone, "First")
    first = stream.next_change()
    _add_task(live, phone, "Second")
    second = stream.next_change()

    assert second["seq"] == first["seq"] + 1
    assert second["revision"] > first["revision"]


def test_a_reconnect_with_the_last_event_id_replays_what_it_missed(
    live: str, tokens: DatabaseTokenStore
) -> None:
    desktop = tokens.add("desktop")
    phone = tokens.add("phone")
    stream = _follow(live, desktop)
    assert stream.connected.wait(20)
    head = stream.heads.get(timeout=10)
    _add_task(live, phone, "First")
    stream.next_change()
    _add_task(live, phone, "Second")
    stream.next_change()

    again = _follow(live, desktop, last_event_id=f"{head['epoch']}:{head['seq']}")
    replayed = [again.next_change(), again.next_change()]

    assert [event["seq"] for event in replayed] == [head["seq"] + 1, head["seq"] + 2]
    assert all("reload" not in event for event in replayed)
    assert again.quiet()


def test_a_reconnect_from_another_run_is_told_to_reload(
    live: str, tokens: DatabaseTokenStore
) -> None:
    desktop = tokens.add("desktop")

    again = _follow(live, desktop, last_event_id="another-run:7")
    event = again.next_change()

    assert event["reload"] is True
    assert "changes" not in event
    assert event["seq"] == again.heads.get(timeout=10)["seq"]


def test_a_reconnect_further_behind_than_the_ring_is_told_to_reload(
    live: str, tokens: DatabaseTokenStore
) -> None:
    desktop = tokens.add("desktop")
    phone = tokens.add("phone")
    stream = _follow(live, desktop)
    assert stream.connected.wait(20)
    head = stream.heads.get(timeout=10)
    for number in range(66):
        _add_task(live, phone, f"Task {number}")
        stream.next_change()

    again = _follow(live, desktop, last_event_id=f"{head['epoch']}:{head['seq']}")
    event = again.next_change()

    assert event["reload"] is True
    assert event["seq"] == head["seq"] + 66


def test_an_undo_reaches_the_stream_as_the_node_gone(live: str, tokens: DatabaseTokenStore) -> None:
    desktop = tokens.add("desktop")
    phone = tokens.add("phone")
    stream = _follow(live, desktop)
    assert stream.connected.wait(20)
    written = _add_task(live, phone, "Undone").json()
    stream.next_change()

    undone = httpx.post(f"{live}/undo", headers={"Authorization": f"Bearer {phone}"})
    assert undone.status_code == 200, undone.text
    event = stream.next_change()

    assert f"task-{written['id']}" in event["changes"]["tasks"]["del"]


def test_a_quiet_connection_is_sent_the_head_at_once(live: str, tokens: DatabaseTokenStore) -> None:
    stream = _follow(live, tokens.add("desktop"))

    head = stream.heads.get(timeout=20)

    assert set(head) == {"epoch", "seq", "revision", "hash", "sums"}
    assert "domains" in head["sums"]


def test_the_current_board_is_the_latest_publication_with_its_four_headers(
    live: str, tokens: DatabaseTokenStore
) -> None:
    desktop = tokens.add("desktop")
    auth = {"Authorization": f"Bearer {desktop}"}
    _add_task(live, desktop, "Published")

    answered = httpx.get(f"{live}/board/current", headers=auth)
    while int(answered.headers["x-arlesh-revision"]) < 1:
        answered = httpx.get(f"{live}/board/current", headers=auth)

    assert answered.status_code == 200
    assert [task["title"] for task in answered.json()["tasks"]] == ["Published"]
    assert int(answered.headers["x-arlesh-seq"]) >= 2
    assert int(answered.headers["x-arlesh-revision"]) == 1
    assert answered.headers["x-arlesh-hash"].isdecimal()
    assert answered.headers["x-arlesh-board-now"]
    assert answered.headers["x-arlesh-epoch"]
