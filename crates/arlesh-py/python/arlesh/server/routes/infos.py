"""Infos: one Info and its writes."""

from __future__ import annotations

from arlesh.models import CreateInfoRequest, Info, UpdateInfoRequest

from arlesh_api.dependencies import Reader, Writer
from arlesh_api.routes import make_router

router = make_router("/infos", "infos")


@router.get("/{id}")
async def get_info(db: Reader, id: int) -> Info:
    """One Info."""
    return await db.get_info(id)


@router.post("", status_code=201)
async def create_info(db: Writer, request: CreateInfoRequest) -> Info:
    """Creates an Info."""
    return await db.create_info(request)


@router.patch("/{id}")
async def update_info(db: Writer, id: int, request: UpdateInfoRequest) -> Info:
    """Updates an Info; naming a parent moves it."""
    return await db.update_info(id, request)


@router.delete("/{id}", status_code=204)
async def delete_info(db: Writer, id: int) -> None:
    """Deletes an Info."""
    await db.delete_info(id)


@router.post("/{id}/duplicate", status_code=201)
async def duplicate_info(
    db: Writer, id: int, target_type: str, target_id: int, position: int
) -> Info:
    """Copies an Info and its subtree under a new parent."""
    return await db.duplicate_info(id, target_type, target_id, position)
