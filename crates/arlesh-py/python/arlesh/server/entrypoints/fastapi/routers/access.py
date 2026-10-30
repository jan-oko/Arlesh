"""The MCP roots: what the agents' MCP can see, shared by every device."""

from __future__ import annotations

from arlesh.models import EffectiveAccess, McpAccessCatalogue, NodeTable
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class McpAccessRouter(BoardRouter):
    """``/mcp-access``."""

    def _register_routes(self) -> None:
        self.get("")(self._list)
        self.get("/catalogue")(self._catalogue)
        self.put("/roots/{node_kind}/{node_id}", status_code=204)(self._add_root)
        self.delete("/roots/{node_kind}/{node_id}", status_code=204)(self._remove_root)

    async def _list(self) -> list[EffectiveAccess]:
        """Every stored node the MCP can see, with the root it is seen through."""
        return await self._reader.list_mcp_access()

    async def _catalogue(self) -> McpAccessCatalogue:
        """The roots, every stored node that could be one, and which may be added now."""
        return await self._reader.mcp_access_catalogue()

    async def _add_root(self, node_kind: NodeTable, node_id: int) -> None:
        """Makes a stored node an MCP root."""
        await (await self._writer()).add_mcp_root(node_kind, node_id)

    async def _remove_root(self, node_kind: NodeTable, node_id: int) -> None:
        """Stops a node being an MCP root."""
        await (await self._writer()).remove_mcp_root(node_kind, node_id)
