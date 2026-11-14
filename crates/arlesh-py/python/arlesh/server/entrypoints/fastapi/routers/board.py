"""The whole board, in one request."""

from __future__ import annotations

from datetime import datetime

from fastapi import Response

from arlesh.models import BlockReason, ItemLifecycle, MindmapLoad, TaskDependencyEdge
from arlesh.server.entrypoints.fastapi.revision import REVISION_HEADER
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter

SEQ_HEADER = "X-Arlesh-Seq"
HASH_HEADER = "X-Arlesh-Hash"
BOARD_NOW_HEADER = "X-Arlesh-Board-Now"


class BoardsRouter(BoardRouter):
    """``/board``."""

    def _register_routes(self) -> None:
        self.get("/current")(self._current)
        self.get("", response_model=MindmapLoad)(self._get)
        self.get("/lifecycles")(self._lifecycles)
        self.get("/task-dependencies")(self._task_dependencies)
        self.get("/block-reasons")(self._block_reasons)

    async def _current(self) -> Response:
        """The latest published board, as it is: the core's JSON, nulls included, with the
        publication's ``X-Arlesh-Seq``, ``X-Arlesh-Revision`` (the publication's, not the board's
        as it stands), ``X-Arlesh-Hash`` and ``X-Arlesh-Board-Now``. Derives nothing: it is what
        the change stream's events apply to."""
        current = await self._reader.board_current()
        return Response(
            content=current.body,
            media_type="application/json",
            headers={
                SEQ_HEADER: str(current.head.seq),
                REVISION_HEADER: str(current.head.revision),
                HASH_HEADER: str(current.head.hash),
                BOARD_NOW_HEADER: current.now,
            },
        )

    async def _get(self, now: datetime | None = None) -> Response:
        """Every node of every kind, with its derived lifecycle, short id and facts.

        ``now`` defaults to the server's clock. The Agentic Tasks of agents at capacity read
        blocked.

        The answer is the core's JSON as it is: reading 1.6 MB into models and writing it out again
        took as long as the core's own work. ``response_model`` stays for the OpenAPI schema only,
        since a returned :class:`Response` is sent without it.
        """
        body = await self._reader.board_json(now=now)
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
