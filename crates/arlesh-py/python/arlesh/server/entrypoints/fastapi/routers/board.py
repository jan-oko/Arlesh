"""The whole board, in one request."""

from __future__ import annotations

from datetime import datetime

from arlesh.models import MindmapLoad
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class BoardsRouter(BoardRouter):
    """``/board``."""

    def _register_routes(self) -> None:
        self.get("")(self._get)

    async def _get(
        self, now: datetime | None = None, at_capacity: bool | None = None
    ) -> MindmapLoad:
        """Every node of every kind, with its derived lifecycle, short id and facts.

        ``now`` defaults to the server's clock, ``at_capacity`` to the agent capacity lock.
        """
        return await self._reader.board(now=now, at_capacity=at_capacity)
