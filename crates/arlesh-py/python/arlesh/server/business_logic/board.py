"""The board the server serves: one database to read through, one per client to write through.

The bindings fix a write-open's client when it opens, and the undo journal stamps every entry with
it, so each client the server admits gets its own write-open, kept until shutdown. Opening is
where the two-writer guard lives: the startup open is refused while the desktop app holds the
database unless the server was forced, and so is a client's first write. Each client's MCP
endpoint is served from its own write-open too, so an agent's writes carry its client.
"""

from __future__ import annotations

import asyncio

import arlesh
from loguru import logger

from arlesh.server.ports.data_access.database_file import DatabaseFile

SERVER_CLIENT = "arlesh-server"
"""The client the startup open writes as. It never writes: each write goes out as the client its
token names."""

LOOPBACK = "127.0.0.1"


class BoardNotOpen(RuntimeError):
    """A request reached the board before startup opened it."""


class Board:
    """The open databases, and the MCP endpoint each client is served from."""

    def __init__(self, database: DatabaseFile, *, force: bool = False) -> None:
        self._database = database
        self._force = force
        self._reader: arlesh.Database | None = None
        self._writers: dict[str, arlesh.Database] = {}
        self._mcp_ports: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def open(self) -> None:
        """Opens the database for writing: the startup guard. Raises what the open raises."""
        self._reader = await self._database.open(SERVER_CLIENT, force=self._force)
        if self._force:
            logger.warning(
                "Forced past the desktop app's hold: if the app is running, it and this server "
                "are two writers to one file"
            )

    async def close(self) -> None:
        """Closes every open database, which stops every MCP endpoint they serve."""
        for writer in self._writers.values():
            await writer.close()
        self._writers.clear()
        self._mcp_ports.clear()
        if self._reader is not None:
            await self._reader.close()
            self._reader = None

    @property
    def reader(self) -> arlesh.Database:
        """The database, for reads."""
        if self._reader is None:
            raise BoardNotOpen("the board is not open")
        return self._reader

    async def writer(self, client: str) -> arlesh.Database:
        """The database open for writing as ``client``, opened on the client's first write.

        The open goes through the guard again, so a client first writing after the desktop app
        took the database is refused.
        """
        async with self._lock:
            return await self._writer(client)

    async def mcp_endpoint(self, client: str) -> str:
        """The URL of ``client``'s own MCP endpoint, served on a private loopback port from its
        write-open on its first MCP request."""
        async with self._lock:
            port = self._mcp_ports.get(client)
            if port is None:
                writer = await self._writer(client)
                port = await writer.serve_mcp(host=LOOPBACK, port=0)
                self._mcp_ports[client] = port
                logger.info("Serving the MCP endpoint", client=client, port=port)
        return f"http://{LOOPBACK}:{port}/mcp"

    async def _writer(self, client: str) -> arlesh.Database:
        writer = self._writers.get(client)
        if writer is None:
            writer = await self._database.open(client, force=self._force)
            self._writers[client] = writer
        return writer
