"""The whole board, in one request."""

from __future__ import annotations

from datetime import datetime

from fastapi import Response

from arlesh.models import BlockReason, ItemLifecycle, MindmapLoad, TaskDependencyEdge
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class BoardsRouter(BoardRouter):
    """``/board``."""

    def _register_routes(self) -> None:
        self.get("", response_model=MindmapLoad)(self._get)
        self.get("/lifecycles")(self._lifecycles)
        self.get("/task-dependencies")(self._task_dependencies)
        self.get("/block-reasons")(self._block_reasons)

    async def _get(
        self, now: datetime | None = None, at_capacity: bool | None = None
    ) -> Response:
        """Every node of every kind, with its derived lifecycle, short id and facts.

        ``now`` defaults to the server's clock, ``at_capacity`` to the agent capacity lock.

        The answer is the core's JSON as it is: reading 1.6 MB into models and writing it out again
        took as long as the core's own work. ``response_model`` stays for the OpenAPI schema only,
        since a returned :class:`Response` is sent without it.
        """
        body = await self._reader.board_json(now=now, at_capacity=at_capacity)
        return Response(content=body, media_type="application/json")

    async def _lifecycles(self, now: datetime | None = None) -> list[ItemLifecycle]:
        """Every node's derived lifecycle, at ``now`` (default: the server's clock)."""
        return await self._reader.scope_lifecycles(now=now)

    async def _task_dependencies(self, now: datetime | None = None) -> list[TaskDependencyEdge]:
        """Every dependency edge on the board."""
        return await self._reader.all_task_dependencies(now=now)

    async def _block_reasons(self) -> list[BlockReason]:
        """Every stored and derived block reason."""
        return await self._reader.list_all_block_reasons()
