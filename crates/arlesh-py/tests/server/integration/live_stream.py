"""A device's subscription to ``/events/changes``, for the server's live tests."""

from __future__ import annotations

import json
import queue
import threading
from typing import Any

import httpx


class Stream:
    """A device's subscription to ``/events/changes``: the ``board-changed`` events and the
    ``board-head`` events it heard, each as its data."""

    def __init__(self) -> None:
        self.changes: queue.Queue[dict[str, Any]] = queue.Queue()
        self.heads: queue.Queue[dict[str, Any]] = queue.Queue()
        self.ids: list[str] = []
        self.connected = threading.Event()

    def next_change(self) -> dict[str, Any]:
        return self.changes.get(timeout=10)

    def quiet(self) -> bool:
        try:
            self.changes.get(timeout=1)
        except queue.Empty:
            return True
        return False


def follow(base: str, token: str, last_event_id: str | None = None) -> Stream:
    """Follows ``/events/changes`` as a device."""
    stream = Stream()

    def run() -> None:
        headers = {"Authorization": f"Bearer {token}", "Accept-Encoding": "gzip"}
        if last_event_id is not None:
            headers["Last-Event-ID"] = last_event_id
        try:
            _read(base, headers, stream)
        except httpx.HTTPError:
            return  # the server shut down with the stream open

    def _read(base: str, headers: dict[str, str], stream: Stream) -> None:
        with httpx.stream("GET", f"{base}/events/changes", headers=headers, timeout=60) as response:
            name = ""
            for line in response.iter_lines():
                if line.startswith(": connected"):
                    stream.connected.set()
                elif line.startswith("id:"):
                    stream.ids.append(line.removeprefix("id:").strip())
                elif line.startswith("event:"):
                    name = line.removeprefix("event:").strip()
                elif line.startswith("data:"):
                    data = json.loads(line.removeprefix("data:").strip())
                    (stream.changes if name == "board-changed" else stream.heads).put(data)

    threading.Thread(target=run, daemon=True).start()
    return stream
