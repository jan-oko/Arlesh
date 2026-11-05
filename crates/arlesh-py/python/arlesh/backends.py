"""The backends an :class:`arlesh.Arlesh` can run on, as the desktop app has them.

A backend is *described* here and opened by :class:`~arlesh.database.Arlesh`; constructing one does
no I/O. :class:`SqliteBackend` is the core over a local SQLite file (the app's Standalone mode);
:class:`HttpBackend` is the app's own Rust client of an ``arlesh-server`` (its Client mode), shared
with the app rather than reimplemented: the revision headers, gzip, TLS, the version handshake and
the read-only board while the server is away are the app's code.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from arlesh import _native
from arlesh.errors import from_native

NativeHandle = _native.NativeDatabase | _native.NativeHttpBackend
"""What an opened backend is, on the native side."""


class BoardRevision(BaseModel):
    """A point in a board's history: how many writes it had committed (``revision``), within one
    run of the server or process (``epoch``). A new epoch is news even when its revision is
    lower."""

    epoch: str
    revision: int


class ServerStatus(BaseModel):
    """What an :class:`HttpBackend` knows about its server between calls."""

    url: str
    reachable: bool
    last_sync: datetime | None
    read_only: Literal["server_unreachable", "update_app", "update_server"] | None
    """Why writes are refused right now, or ``None`` when they are allowed."""
    server_api_version: int | None


class Backend(ABC):
    """Something an :class:`~arlesh.database.Arlesh` can run on."""

    @abstractmethod
    async def connect(self) -> NativeHandle:
        """Opens the backend and answers its native handle. May do I/O, and be refused."""


class SqliteBackend(Backend):
    """The core over the SQLite file at ``path``.

    Without a ``client`` it opens **read-only**; with one — a name of letters, digits, ``.``,
    ``_`` and ``-``, recorded on every write in the undo journal — it opens for writing, migrating
    the file if needed, and is refused while the desktop app holds it unless ``force``.
    """

    def __init__(
        self, path: str | os.PathLike[str], *, client: str | None = None, force: bool = False
    ) -> None:
        self.path = path
        self.client = client
        self.force = force

    async def connect(self) -> NativeHandle:
        try:
            return await _native.open(self.path, self.client, self.force)
        except _native.NativeError as error:
            raise from_native(error) from None


class HttpBackend(Backend):
    """An ``arlesh-server`` at ``url``, reached with the bearer ``token`` (see ``arlesh.pairing``).

    The token names the client, so none is given here. When the server cannot be reached the board
    is the one last loaded and every write is refused with ``NotPermitted``
    (``details["reason"] == "server_unreachable"``); nothing is queued.
    """

    def __init__(self, url: str, *, token: str) -> None:
        self.url = url
        self.token = token

    async def connect(self) -> NativeHandle:
        try:
            return await _native.connect(self.url, self.token)
        except _native.NativeError as error:
            raise from_native(error) from None
