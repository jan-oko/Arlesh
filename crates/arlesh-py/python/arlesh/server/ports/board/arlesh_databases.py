"""The board port over ``arlesh.open``: a write-open per client, opened on its first write."""

from __future__ import annotations

import asyncio
from pathlib import Path

from loguru import logger

import arlesh
from arlesh.server.ports.board.databases import Databases

SERVICE_CLIENT = "arlesh-server"
"""The client the startup open writes as. It never writes: each write goes out as the client its
token names."""


class DatabasesNotOpen(RuntimeError):
    """A request reached the databases before startup opened them."""


class ArleshDatabases(Databases):
    """The bindings fix a write-open's client when it opens, and the journal stamps every entry
    with it, so each client gets its own write-open, kept until shutdown. Each open goes through
    the core's guard: refused while the desktop app holds the database, unless ``force``."""

    def __init__(self, path: Path, *, force: bool = False) -> None:
        self._path = path
        self._force = force
        self._reader: arlesh.Database | None = None
        self._writers: dict[str, arlesh.Database] = {}
        self._opening = asyncio.Lock()

    async def open(self) -> None:
        self._reader = await arlesh.open(self._path, client=SERVICE_CLIENT, force=self._force)
        if self._force:
            logger.warning(
                "Forced past the desktop app's hold: if the app is running, it and this server "
                "are two writers to one file",
                database=str(self._path),
            )

    async def close(self) -> None:
        for writer in self._writers.values():
            await writer.close()
        self._writers.clear()
        if self._reader is not None:
            await self._reader.close()
            self._reader = None

    @property
    def reader(self) -> arlesh.Database:
        if self._reader is None:
            raise DatabasesNotOpen("the databases are not open")
        return self._reader

    async def writer(self, client: str) -> arlesh.Database:
        async with self._opening:
            writer = self._writers.get(client)
            if writer is None:
                writer = await arlesh.open(self._path, client=client, force=self._force)
                self._writers[client] = writer
            return writer
