"""The board the server serves: one database to read through, one per client to write through.

The server is the database's one writer while it runs. At startup it takes the **hold** — the
lock the desktop app takes while it runs — so another server or an app started meanwhile finds
the database held. Holding it, the server opens past the open's own check, which would otherwise
find the server's own hold. ``force`` starts it even though the database is held, and then it
takes no hold.

The bindings fix a write-open's client when it opens, and the undo journal stamps every entry with
it, so each client the server admits gets its own write-open, kept until shutdown. Each client's
MCP endpoint is served from its own write-open too, so an agent's writes carry its client.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from loguru import logger

import arlesh

OpenAs = Callable[[str], Awaitable[arlesh.Database]]
"""Opens the database for writing as a client, past the hold check: ``open_as(client)``.

It answers the ``arlesh`` package's :class:`arlesh.Database` port. The composition root hands in
one over :func:`arlesh.open` (``force=True``), whose :class:`arlesh.SqliteDatabase` is the port's
implementation; a test hands in one answering a fake. It raises what :func:`arlesh.open` raises,
such as :class:`arlesh.InvalidRequest` for a client name the core refuses.
"""

TakeHold = Callable[[], arlesh.Hold]
"""Takes the hold on the database: :func:`arlesh.hold` over its path. Raises
:class:`arlesh.NotPermitted` (``held``) while the app or another server has it."""

SERVER_CLIENT = "arlesh-server"
"""The client the startup open writes as. It never writes: each write goes out as the client its
token names."""

LOOPBACK = "127.0.0.1"


class BoardNotOpen(RuntimeError):
    """A request reached the board before startup opened it."""


class Board:
    """The open databases, and the MCP endpoint each client is served from."""

    def __init__(self, open_as: OpenAs, take_hold: TakeHold, *, force: bool = False) -> None:
        self._open_as = open_as
        self._take_hold = take_hold
        self._force = force
        self._hold: arlesh.Hold | None = None
        self._reader: arlesh.Database | None = None
        self._writers: dict[str, arlesh.Database] = {}
        self._mcp_ports: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def open(self) -> None:
        """Takes the hold and opens the database for writing: the startup guard.

        Raises :class:`arlesh.NotPermitted` (``held``) while the desktop app or another server
        holds the database, unless forced; and whatever the open raises.
        """
        if self._force:
            logger.warning(
                "Forced: not holding the database. If the desktop app or another server is "
                "writing to it, they and this server are two writers to one file"
            )
        else:
            self._hold = self._take_hold()
        try:
            self._reader = await self._open_as(SERVER_CLIENT)
        except BaseException:
            self._release()
            raise

    async def close(self) -> None:
        """Closes every open database, which stops every MCP endpoint they serve."""
        for writer in self._writers.values():
            await writer.close()
        self._writers.clear()
        self._mcp_ports.clear()
        if self._reader is not None:
            await self._reader.close()
            self._reader = None
        self._release()

    @property
    def reader(self) -> arlesh.Database:
        """The database, for reads."""
        if self._reader is None:
            raise BoardNotOpen("the board is not open")
        return self._reader

    async def writer(self, client: str) -> arlesh.Database:
        """The database open for writing as ``client``, opened on the client's first write."""
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
            writer = await self._open_as(client)
            self._writers[client] = writer
        return writer

    def _release(self) -> None:
        if self._hold is not None:
            self._hold.release()
            self._hold = None
