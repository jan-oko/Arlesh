"""The whole board, in one request."""

from __future__ import annotations

from datetime import datetime

from arlesh.models import BlockReason, ItemLifecycle, MindmapLoad, TaskDependencyEdge
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class BoardsRouter(BoardRouter):
    """``/board``."""

    def _register_routes(self) -> None:
        self.get("")(self._get)
        self.get("/lifecycles")(self._lifecycles)
        self.get("/task-dependencies")(self._task_dependencies)
        self.get("/block-reasons")(self._block_reasons)

    async def _get(self, now: datetime | None = None) -> MindmapLoad:
        """Every node of every kind, with its derived lifecycle, short id and facts.

        ``now`` defaults to the server's clock. The Agentic Tasks of agents at capacity read
        blocked.
        """
        return await self._reader.board(now=now)

    async def _lifecycles(self, now: datetime | None = None) -> list[ItemLifecycle]:
        """Every node's derived lifecycle, at ``now`` (default: the server's clock)."""
        return await self._reader.scope_lifecycles(now=now)

    async def _task_dependencies(self, now: datetime | None = None) -> list[TaskDependencyEdge]:
        """Every dependency edge on the board."""
        return await self._reader.all_task_dependencies(now=now)

    async def _block_reasons(self) -> list[BlockReason]:
        """Every stored and derived block reason."""
        return await self._reader.list_all_block_reasons()
