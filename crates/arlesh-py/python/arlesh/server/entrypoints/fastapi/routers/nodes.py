"""What several kinds of node carry: Tags and explicit block reasons."""

from __future__ import annotations

from typing import Literal

from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter, node_id

Taggable = Literal["task", "goal", "commitment", "expectation"]


class NodesRouter(BoardRouter):
    """``/nodes``."""

    def _register_routes(self) -> None:
        self.put("/{kind}/{id}/tags/{tag_id}", status_code=204)(self._put_tag)
        self.delete("/{kind}/{id}/tags/{tag_id}", status_code=204)(self._remove_tag)
        self.put("/{owner_type}/{id}/block-reasons", status_code=204)(self._set_block_reasons)

    async def _put_tag(self, kind: Taggable, id: str, tag_id: int) -> None:
        """Puts a Tag on a node."""
        await (await self._writer()).set_tag(kind, node_id(id), tag_id, True)

    async def _remove_tag(self, kind: Taggable, id: str, tag_id: int) -> None:
        """Takes a Tag off a node."""
        await (await self._writer()).set_tag(kind, node_id(id), tag_id, False)

    async def _set_block_reasons(
        self, owner_type: Literal["task", "goal"], id: str, reasons: list[str]
    ) -> None:
        """Replaces a Task's or Goal's explicit block reasons, in order."""
        await (await self._writer()).set_block_reasons(owner_type, node_id(id), reasons)
