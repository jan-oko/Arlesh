"""What any of several kinds of node carries: its Tags and its explicit block reasons."""

from __future__ import annotations

from typing import Literal

from arlesh_api.dependencies import Writer, node_id
from arlesh_api.routes import make_router

router = make_router("/nodes", "nodes")

Taggable = Literal["task", "goal", "commitment", "expectation"]


@router.put("/{kind}/{id}/tags/{tag_id}", status_code=204)
async def put_tag(db: Writer, kind: Taggable, id: str, tag_id: int) -> None:
    """Puts a Tag on a node."""
    await db.set_tag(kind, node_id(id), tag_id, True)


@router.delete("/{kind}/{id}/tags/{tag_id}", status_code=204)
async def remove_tag(db: Writer, kind: Taggable, id: str, tag_id: int) -> None:
    """Takes a Tag off a node."""
    await db.set_tag(kind, node_id(id), tag_id, False)


@router.put("/{owner_type}/{id}/block-reasons", status_code=204)
async def set_block_reasons(
    db: Writer, owner_type: Literal["task", "goal"], id: str, reasons: list[str]
) -> None:
    """Replaces a Task's or Goal's explicit block reasons, in order."""
    await db.set_block_reasons(owner_type, node_id(id), reasons)
