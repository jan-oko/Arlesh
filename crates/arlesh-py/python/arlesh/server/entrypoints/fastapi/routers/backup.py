"""``GET /backup``: a consistent snapshot of the database, for the administrator.

Open without a device token and guarded by its own secret, ``ARLESH_BACKUP_TOKEN``: a paired
device's token does not grant it. Without that secret configured the route does not exist.

The snapshot is taken with SQLite's online backup API over a read-only connection to the
configured file, in a worker thread, a slice of pages at a time: writers are never blocked for
long, and nothing is ever written to the live database. It goes into a temporary file that is
streamed and then deleted.
"""

from __future__ import annotations

import asyncio
import hmac
import os
import sqlite3
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Request
from starlette.background import BackgroundTask
from starlette.responses import FileResponse

from arlesh.server.entrypoints.fastapi.exceptions import AuthenticationFailed
from arlesh.server.entrypoints.fastapi.rate_limit import RateLimiter

MEDIA_TYPE = "application/vnd.sqlite3"
ATTEMPTS_PER_WINDOW = 20
WINDOW_SECONDS = 600.0
PAGES_PER_STEP = 256
"""Pages copied between yields to writers."""


def snapshot(source: Path, target: Path) -> None:
    """Copies the database at ``source`` to ``target`` as of one moment, through a read-only
    connection. The copy is a plain (non-WAL) file, whole in itself."""
    live = sqlite3.connect(f"file:{source.resolve().as_posix()}?mode=ro", uri=True, timeout=30)
    try:
        copy = sqlite3.connect(target)
        try:
            live.backup(copy, pages=PAGES_PER_STEP, sleep=0.001)
            copy.execute("PRAGMA journal_mode=DELETE")
        finally:
            copy.close()
    finally:
        live.close()


def _remove(path: Path) -> None:
    for suffix in ("", "-wal", "-shm", "-journal"):
        path.with_name(path.name + suffix).unlink(missing_ok=True)


class BackupRouter(APIRouter):
    """``/backup``, present only when a backup token is configured."""

    def __init__(self, database: Path, token: str) -> None:
        super().__init__(tags=["backup"])
        self._database = database
        self._token = token.encode()
        self._limiter = RateLimiter(ATTEMPTS_PER_WINDOW, WINDOW_SECONDS)
        self.get("", response_class=FileResponse, summary="A snapshot of the database")(self._get)

    async def _get(self, request: Request) -> FileResponse:
        """Streams a consistent SQLite copy of the database. ``Authorization: Bearer
        <ARLESH_BACKUP_TOKEN>``; anything else is 401."""
        self._admit(request)
        descriptor, name = tempfile.mkstemp(prefix="arlesh-backup-", suffix=".db")
        os.close(descriptor)
        target = Path(name)
        try:
            await asyncio.to_thread(snapshot, self._database, target)
        except BaseException:
            _remove(target)
            raise
        stamp = datetime.now(UTC).strftime("%Y-%m-%d")
        return FileResponse(
            target,
            media_type=MEDIA_TYPE,
            filename=f"arlesh-{stamp}.db",
            background=BackgroundTask(_remove, target),
        )

    def _admit(self, request: Request) -> None:
        host = request.client.host if request.client is not None else ""
        self._limiter.hit(host)
        scheme, _, given = request.headers.get("Authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not given:
            raise AuthenticationFailed("missing_token")
        if not hmac.compare_digest(given.strip().encode(), self._token):
            raise AuthenticationFailed("bad_token")
