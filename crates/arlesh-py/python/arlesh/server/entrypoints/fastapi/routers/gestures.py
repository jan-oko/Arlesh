"""The gesture operations: each gesture the app makes over several nodes, as one request — one
transaction, one Gesture, one undo step on the calling client's stack."""

from __future__ import annotations

from arlesh.models import GestureNode
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class GesturesRouter(BoardRouter):
    """``/gestures``."""

    def _register_routes(self) -> None:
        self.post("/delete-nodes", status_code=204)(self._delete_nodes)

    async def _delete_nodes(self, nodes: list[GestureNode]) -> None:
        """Deletes every node in the body, all or nothing: a multi-selection, or a subtree."""
        await (await self._writer()).delete_nodes(nodes)
