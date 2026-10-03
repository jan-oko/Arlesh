"""The MCP backend port: where a client's MCP requests are answered."""

from __future__ import annotations

from abc import ABC, abstractmethod


class McpBackend(ABC):
    """Hands out the upstream MCP endpoint a client's requests are proxied to."""

    @abstractmethod
    async def endpoint(self, client: str) -> str:
        """The URL of the MCP endpoint that answers as ``client``, started if need be."""
