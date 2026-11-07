"""Live sync across two devices, over a real socket: one device's write reaches another device's
``/events/changes`` subscription, stamped with the revision the write reached."""

from __future__ import annotations

import json
import queue
import threading
from collections.abc import Callable
from typing import Any

import httpx
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore

ROOT_ASPECT = 1
Start = Callable[..., ArleshServer]


def _subscribe(base: str, token: str) -> tuple[queue.Queue[dict[str, Any]], threading.Event]:
    """Follows ``/events/changes`` as a device; each ``board-changed``'s data lands on the queue."""
    heard: queue.Queue[dict[str, Any]] = queue.Queue()
    connected = threading.Event()

    def follow() -> None:
        headers = {"Authorization": f"Bearer {token}", "Accept-Encoding": "gzip"}
        with httpx.stream("GET", f"{base}/events/changes", headers=headers, timeout=60) as response:
            name = ""
            for line in response.iter_lines():
                if line.startswith(": connected"):
                    connected.set()
                elif line.startswith("event:"):
                    name = line.removeprefix("event:").strip()
                elif line.startswith("data:") and name == "board-changed":
                    heard.put(json.loads(line.removeprefix("data:").strip()))

    threading.Thread(target=follow, daemon=True).start()
    return heard, connected


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
