"""Undo and redo, per client: each device's token is its own client, and each write a client
makes through any route is one Gesture on that client's own stacks."""

from __future__ import annotations

from arlesh.models import GestureSummary, UndoStatus
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class UndoRouter(BoardRouter):
    """``/undo`` and ``/redo``."""

    def _register_routes(self) -> None:
        self.get("/undo")(self._status)
        self.post("/undo")(self._undo)
        self.post("/redo")(self._redo)

    async def _status(self) -> UndoStatus:
        """What the calling client's next undo and redo would be."""
        return await (await self._writer()).undo_status()

    async def _undo(self) -> GestureSummary | None:
        """Reverses the calling client's most recent Gesture, and answers it; ``null`` when there
        is nothing to undo. Refused, changing nothing, when a later write by anyone stands on a
        row the Gesture would restore."""
        return await (await self._writer()).undo()

    async def _redo(self) -> GestureSummary | None:
        """Reapplies the calling client's most recently undone Gesture; ``null`` when there is
        none."""
        return await (await self._writer()).redo()
