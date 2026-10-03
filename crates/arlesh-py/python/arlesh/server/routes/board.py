"""The whole board, in one request."""

from __future__ import annotations

from datetime import datetime

from arlesh.models import MindmapLoad

from arlesh_api.dependencies import Reader
from arlesh_api.routes import make_router

router = make_router("/board", "board")


@router.get("")
async def get_board(
    db: Reader, now: datetime | None = None, at_capacity: bool | None = None
) -> MindmapLoad:
    """Every node of every kind, with its derived lifecycle, short id and facts.

    ``now`` defaults to the service's clock, ``at_capacity`` to the agent capacity lock.
    """
    return await db.board(now=now, at_capacity=at_capacity)
