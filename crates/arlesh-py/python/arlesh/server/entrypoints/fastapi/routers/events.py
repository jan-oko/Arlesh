"""``/events/changes``: the board's changes as Server-Sent Events, for live sync between devices.

The server's publisher derives the board after every committed write — through any route, any
client, or an agent through ``/mcp`` — and once a minute, compares it with the board it last
published and makes a **publication**: the next sequence number, the revision it read, the board
hash and the nodes that changed. The stream sends one ``board-changed`` event per publication, so
a device updates from the event alone; writes that land close together arrive as one event.

Each event's id is ``<epoch>:<seq>``. The epoch names this run of the server, since the sequence
starts again when the server restarts. A client that reconnects with ``Last-Event-ID`` of this run
is sent the events it missed from the publisher's ring; when the ring no longer holds them all, or
the id is another run's or cannot be read, it is sent one ``reload`` event at the latest
publication. A ``board-head`` event, the latest publication's identity, is sent on connecting and
after every quiet ``KEEPALIVE_SECONDS``, in place of a keepalive comment.

(``docs/spec/http-api.md``, *Live sync*; ``docs/adr/0020-changed-nodes-and-board-hash.md``.)
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Header, Request
from fastapi.responses import StreamingResponse

import arlesh
from arlesh.backends import BoardHead
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter
from arlesh.server.entrypoints.fastapi.shutdown import going_down

BOARD_CHANGED = "board-changed"
"""The event's name: the same as the app's Tauri event."""

BOARD_HEAD = "board-head"
"""The head event's name: the latest publication's identity, sent when the stream is quiet."""

KEEPALIVE_SECONDS = 15.0
"""How long the stream stays silent before it sends the head, so a proxy keeps it open."""

SHUTDOWN_POLL_SECONDS = 0.5
"""How often a quiet stream looks up to see whether the server is going down."""


def _event(epoch: str, seq: int, data: str) -> str:
    return f"id: {epoch}:{seq}\nevent: {BOARD_CHANGED}\ndata: {data}\n\n"


def _head_event(head: BoardHead) -> str:
    return f"event: {BOARD_HEAD}\ndata: {head.model_dump_json()}\n\n"


def _resume_point(epoch: str, last_event_id: str | None) -> int | None:
    """The sequence number a reconnecting client had reached, or ``None`` when it saw none of this
    run (a first connection, an id from another run, or one that cannot be read)."""
    if last_event_id is None:
        return None
    seen_epoch, _, seen = last_event_id.partition(":")
    if seen_epoch != epoch or not seen.isdecimal():
        return None
    return int(seen)


async def _latest(database: arlesh.Database) -> BoardHead:
    """The latest publication's head, once there is one."""
    head = database.board_head()
    if head is None:
        await database.board_current()
        head = database.board_head()
    assert head is not None  # `board_current` answers only once a publication exists
    return head


async def board_changes(
    database: arlesh.Database,
    *,
    epoch: str,
    last_event_id: str | None,
    keepalive: float = KEEPALIVE_SECONDS,
) -> AsyncIterator[str]:
    """The stream's text: the events a reconnecting client missed, the head, then an event for
    each publication, and the head again whenever it has been quiet for ``keepalive`` seconds."""
    last = 0
    if last_event_id is None:
        last = (await _latest(database)).seq
    else:
        resume = _resume_point(epoch, last_event_id)
        last = resume if resume is not None else 0
        for seq, data in await database.board_events_after(last, 0):
            yield _event(epoch, seq, data)
            last = seq
    yield ": connected\n\n"
    yield _head_event(await _latest(database))
    quiet = 0.0
    while True:
        if going_down():
            return
        events = await database.board_events_after(last, SHUTDOWN_POLL_SECONDS)
        for seq, data in events:
            yield _event(epoch, seq, data)
            last = seq
        quiet = 0.0 if events else quiet + SHUTDOWN_POLL_SECONDS
        if quiet >= keepalive:
            quiet = 0.0
            yield _head_event(await _latest(database))


class EventsRouter(BoardRouter):
    """``/events/changes``."""

    def _register_routes(self) -> None:
        self.get("", response_class=StreamingResponse)(self._stream)

    async def _stream(
        self,
        request: Request,
        last_event_id: str | None = Header(default=None),
    ) -> StreamingResponse:
        """``board-changed`` for each publication, with its changed nodes, as Server-Sent Events.
        Send ``Last-Event-ID`` on a reconnect to be sent at once what was missed."""
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
