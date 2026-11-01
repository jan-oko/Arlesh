"""Every answer says which board it saw: the **revision** and the **epoch** headers, and gzip.

A device that holds a copy of the board needs to know whether the next change it hears about is
news. ``GET /events`` sends the revision each change reached; this puts the same pair on every
other answer, so a device can compare them (``docs/spec/http-api.md``, *Revision*):

* ``X-Arlesh-Revision``: how many writes the board has committed this run.
* ``X-Arlesh-Epoch``: names this run. The revision starts again at 0 when the server restarts, so
  a revision means something only beside the epoch it was read under.

A **read** carries the revision as it stood when the request *arrived*, before the read ran, so a
write landing mid-read makes the copy look older than it is and never newer: the device reloads
once too often, never once too few. A **write** carries the revision after it committed.

These are pure ASGI middleware, not ``BaseHTTPMiddleware``, so ``/events`` streams straight
through them.
"""

from __future__ import annotations

from collections.abc import Callable

from starlette.datastructures import MutableHeaders
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from arlesh.server.business_logic.board import BoardNotOpen

REVISION_HEADER = "X-Arlesh-Revision"
EPOCH_HEADER = "X-Arlesh-Epoch"

EVENTS_PATH = "/events"
"""The change stream: never compressed, since gzip buffers a stream until it has enough to
compress, and an event must reach the device as it happens."""

GZIP_MINIMUM_BYTES = 1024
"""Answers smaller than this are sent as they are: compressing them costs more than it saves."""

READS = frozenset({"GET", "HEAD"})


class RevisionHeadersMiddleware:
    """Stamps every HTTP answer with the board's revision and epoch."""

    def __init__(self, app: ASGIApp, *, revision: Callable[[], int], epoch: str) -> None:
        self._app = app
        self._revision = revision
        self._epoch = epoch

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        arrived = self._read()
        is_read = scope["method"] in READS

        async def stamped(message: Message) -> None:
            if message["type"] == "http.response.start":
                revision = arrived if is_read else self._read()
                if revision is not None:
                    headers = MutableHeaders(scope=message)
                    headers[REVISION_HEADER] = str(revision)
                    headers[EPOCH_HEADER] = self._epoch
            await send(message)

        await self._app(scope, receive, stamped)

    def _read(self) -> int | None:
        try:
            return self._revision()
        except BoardNotOpen:
            return None


class GzipExceptEventsMiddleware:
    """gzip for every answer but the change stream's."""

    def __init__(self, app: ASGIApp) -> None:
        self._app = app
        self._compressed = GZipMiddleware(app, minimum_size=GZIP_MINIMUM_BYTES)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].endswith(EVENTS_PATH):
            await self._app(scope, receive, send)
        else:
            await self._compressed(scope, receive, send)
