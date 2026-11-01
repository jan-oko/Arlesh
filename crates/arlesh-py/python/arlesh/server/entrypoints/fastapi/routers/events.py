"""``/events``: the board's changes as Server-Sent Events, for live sync between devices.

Every committed write — through any route, any client, or an agent through ``/mcp`` — bumps the
board's **revision**. The stream sends one ``board-changed`` event when the revision moves past the
last one it sent, carrying the revision it reached, so writes that land close together arrive as
one event: a device only needs to know that it must reload, not how many times.

Each event's id is ``<epoch>:<revision>``. The epoch names this run of the server, since the
revision starts again at 0 when the server restarts. A client that reconnects with
``Last-Event-ID`` is sent one event at once when it has missed anything: the revision has moved
past its own, or the server has restarted since.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import Header, Request
from fastapi.responses import StreamingResponse

import arlesh
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter

BOARD_CHANGED = "board-changed"
"""The event's name: the same as the app's Tauri event a window reloads on."""

KEEPALIVE_SECONDS = 15.0
"""How long the stream stays silent before it sends a comment, so a proxy keeps it open."""


def _event(epoch: str, revision: int) -> str:
    data = json.dumps({"revision": revision, "epoch": epoch})
    return f"id: {epoch}:{revision}\nevent: {BOARD_CHANGED}\ndata: {data}\n\n"


def _resume_point(epoch: str, last_event_id: str | None) -> int | None:
    """The revision a reconnecting client had reached, or ``None`` when it saw none of this run
    (a first connection, an id from another run, or one that cannot be read)."""
    if last_event_id is None:
        return None
    seen_epoch, _, seen = last_event_id.partition(":")
    if seen_epoch != epoch or not seen.isdecimal():
        return None
    return int(seen)


async def board_changes(
    database: arlesh.Database,
    *,
    epoch: str,
    last_event_id: str | None,
    keepalive: float = KEEPALIVE_SECONDS,
) -> AsyncIterator[str]:
    """The stream's text: an event for each revision past the one the client has, and a comment
    whenever it has been quiet for ``keepalive`` seconds."""
    current = database.revision
    seen = _resume_point(epoch, last_event_id)
    if last_event_id is not None and (seen is None or seen < current):
        yield _event(epoch, current)
    yield ": connected\n\n"
    while True:
        waiting = asyncio.ensure_future(database.next_change(current))
        try:
            while not waiting.done():
                done, _ = await asyncio.wait({waiting}, timeout=keepalive)
                if not done:
                    yield ": keepalive\n\n"
            current = waiting.result()
        finally:
            waiting.cancel()
        yield _event(epoch, current)


class EventsRouter(BoardRouter):
    """``/events``."""

    def _register_routes(self) -> None:
        self.get("", response_class=StreamingResponse)(self._stream)

    async def _stream(
        self,
        request: Request,
        last_event_id: str | None = Header(default=None),
    ) -> StreamingResponse:
        """``board-changed`` for each committed write, as Server-Sent Events. Send
        ``Last-Event-ID`` on a reconnect to hear at once about anything missed."""
        changes = board_changes(self._reader, epoch=self._board.epoch, last_event_id=last_event_id)
        return StreamingResponse(
            _until_disconnected(request, changes),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )


async def _until_disconnected(request: Request, changes: AsyncIterator[str]) -> AsyncIterator[str]:
    async for chunk in changes:
        if await request.is_disconnected():
            return
        yield chunk
