"""The MCP backend over the bindings: the core's own MCP router, one per client.

``Database.serve_mcp`` serves Arlesh's MCP endpoint over a database opened for writing, and an
agent's writes through it are journaled under that database's client. Serving one per client —
on the client's own write-open, on a private loopback port — keeps the token deciding who wrote,
for the MCP as for every other route. Each stops when its database closes, at shutdown.
"""

from __future__ import annotations

import asyncio

from loguru import logger

from arlesh.server.ports.board.databases import Databases
from arlesh.server.ports.mcp.mcp_backend import McpBackend

LOOPBACK = "127.0.0.1"


class ArleshMcpBackend(McpBackend):
    """Starts a client's MCP endpoint on its first MCP request, and keeps it."""

    def __init__(self, databases: Databases) -> None:
        self._databases = databases
        self._ports: dict[str, int] = {}
        self._starting = asyncio.Lock()

    async def endpoint(self, client: str) -> str:
        async with self._starting:
            port = self._ports.get(client)
            if port is None:
                writer = await self._databases.writer(client)
                port = await writer.serve_mcp(host=LOOPBACK, port=0)
                self._ports[client] = port
                logger.info("Serving the MCP endpoint", client=client, port=port)
        return f"http://{LOOPBACK}:{port}/mcp"
