"""What several kinds of node carry: Tags and explicit block reasons."""

from __future__ import annotations

from typing import Literal

from arlesh.models import ReparentConflicts, TimeScope, ViolatingDescendant
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter, node_id

Taggable = Literal["task", "goal", "commitment", "expectation"]


class NodesRouter(BoardRouter):
    """``/nodes``."""

    def _register_routes(self) -> None:
        self.put("/{kind}/{id}/tags/{tag_id}", status_code=204)(self._put_tag)
        self.delete("/{kind}/{id}/tags/{tag_id}", status_code=204)(self._remove_tag)
        self.put("/{owner_type}/{id}/block-reasons", status_code=204)(self._set_block_reasons)
        self.post("/{kind}/{id}/scope-containment-conflicts")(self._scope_conflicts)
        self.get("/{kind}/{id}/reparent-conflicts")(self._reparent_conflicts)

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

    async def _scope_conflicts(
        self, kind: str, id: int, time_scope: TimeScope
    ) -> list[ViolatingDescendant]:
        """The node's descendants that ``time_scope`` (the body) would leave outside it, for the
        clamp-or-cancel prompt. Writes nothing."""
        return await self._reader.scope_containment_conflicts(kind, id, time_scope)

    async def _reparent_conflicts(
        self, kind: str, id: int, parent_type: str, parent_id: int
    ) -> ReparentConflicts:
        """What moving the node under ``parent_type`` ``parent_id`` would leave outside its new
        ancestors' Time Scope, and the scope to clamp them to. Writes nothing."""
        return await self._reader.reparent_conflicts(kind, id, parent_type, parent_id)
