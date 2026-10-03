"""The service's open databases: one it reads through, and one per client it writes as.

The bindings fix a write-open's client when it opens (``arlesh.open(path, client=...)``), and the
journal stamps every entry with it. A request names its client in ``X-Arlesh-Client``, so each
client name gets its own write-open, opened on its first write and kept until shutdown. Every
write-open goes through the core's guard: it is refused while the desktop app holds the database,
unless the service was started forced.
"""

from __future__ import annotations

import asyncio
import logging

import arlesh

from arlesh_api.settings import SERVICE_CLIENT, Settings

log = logging.getLogger(__name__)

FORCED_WARNING = (
    "FORCED: opened %s for writing without regard to the desktop app's hold. If the app is "
    "running, it and this service are now two writers to one file, and each can overwrite what "
    "the other shows. Stop one of them."
)


class Connections:
    """The reader, opened at startup, and the writers, opened per client on demand."""

    def __init__(self, settings: Settings, reader: arlesh.Database) -> None:
        self._settings = settings
        self.reader = reader
        self._writers: dict[str, arlesh.Database] = {}
        self._opening = asyncio.Lock()

    @classmethod
    async def open(cls, settings: Settings) -> Connections:
        """Opens the database for writing — the startup guard — and keeps it to read through.

        Raises :class:`arlesh.NotPermitted` while the desktop app holds the database, unless
        ``settings.force``; migrates a schema that is behind; refuses one that is ahead.
        """
        reader = await arlesh.open(settings.db_path, client=SERVICE_CLIENT, force=settings.force)
        if settings.force:
            log.warning(FORCED_WARNING, settings.db_path)
        return cls(settings, reader)

    async def writer(self, client: str) -> arlesh.Database:
        """The database open for writing as ``client``, opening it on the client's first write.

        The open is the core's: a name it does not accept is ``invalid_request``, and the app's
        hold is checked again, so a write is refused if the app started after the service.
        """
        async with self._opening:
            writer = self._writers.get(client)
            if writer is None:
                writer = await arlesh.open(
                    self._settings.db_path, client=client, force=self._settings.force
                )
                self._writers[client] = writer
            return writer

    async def close(self) -> None:
        """Closes every open database."""
        for writer in self._writers.values():
            await writer.close()
        self._writers.clear()
        await self.reader.close()
