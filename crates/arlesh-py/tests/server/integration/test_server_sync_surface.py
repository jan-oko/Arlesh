"""The sync surface a client's Replica needs (ADR 0017, Task ``ccc``): the changed source rows on
each event, the device snapshot and the source hash, over a real socket."""

from __future__ import annotations

from collections.abc import Callable

import httpx
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore

from tests.server.integration.live_stream import follow

ROOT_ASPECT = "4440ccd1-f5c6-5057-898c-f89df62d6f60"
Start = Callable[..., ArleshServer]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_the_snapshot_needs_a_device_token(live: str) -> None:
    assert httpx.get(f"{live}/board/snapshot").status_code == 401


def test_the_snapshot_holds_the_rows_the_epoch_the_schema_and_no_server_only_table(
    live: str, tokens: DatabaseTokenStore
) -> None:
    token = tokens.add("phone")

    response = httpx.get(f"{live}/board/snapshot", headers=_auth(token))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["epoch"] == response.headers["x-arlesh-epoch"]
    assert body["schema_version"] >= 111
    assert len(body["source"]["hash"]) == 16
    assert body["source"]["count"] == sum(len(rows) for rows in body["tables"].values())
    assert any(row["image"]["id"] == ROOT_ASPECT for row in body["tables"]["domains"])
    for table in ("server_tokens", "pairing_pins", "connect_tokens", "change_log"):
        assert table not in body["tables"]
    assert "sha256" not in response.text


def test_a_write_reaches_a_device_as_the_rows_it_changed_and_the_head_agrees(
    live: str, tokens: DatabaseTokenStore
) -> None:
    desktop = tokens.add("desktop")
    phone = tokens.add("phone")
    stream = follow(live, desktop, rows=True)
    plain = follow(live, tokens.add("old-app"))
    assert stream.connected.wait(20)
    assert plain.connected.wait(20)
    before = httpx.get(f"{live}/board/snapshot", headers=_auth(desktop)).json()

    written = httpx.post(
        f"{live}/tasks",
        json={"title": "From the phone", "parent_type": "domain", "parent_id": ROOT_ASPECT},
        headers=_auth(phone),
    )
    assert written.status_code == 201, written.text

    event = stream.next_change()
    source = event["source"]
    assert source["base"] <= before["source"]["upto"] < source["upto"]
    created = [r for r in source["rows"] if r["table"] == "tasks" and r["op"] == "set"]
    assert [r["image"]["title"] for r in created] == ["From the phone"]
    after = httpx.get(f"{live}/board/snapshot", headers=_auth(desktop)).json()
    assert after["source"]["upto"] == source["upto"]
    assert after["source"]["hash"] == source["hash"]
    head = stream.heads.get(timeout=10)
    assert head["source"]["upto"] >= before["source"]["upto"]
    # An app that predates the Replica reads exactly what it always did: no `source` anywhere.
    old_event = plain.next_change()
    assert "source" not in old_event
    assert set(old_event) == {"epoch", "seq", "revision", "now", "hash", "changes"}
    assert "source" not in plain.heads.get(timeout=10)
