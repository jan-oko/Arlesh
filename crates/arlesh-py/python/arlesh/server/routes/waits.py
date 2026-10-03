"""Waits (Expectations): their writes and their checks."""

from __future__ import annotations

from datetime import datetime

from arlesh.models import CreateExpectationRequest, Expectation, UpdateExpectationRequest

from arlesh_api.dependencies import Writer, node_id
from arlesh_api.routes import make_router

router = make_router("/waits", "waits")


@router.post("", status_code=201)
async def create_wait(db: Writer, request: CreateExpectationRequest) -> Expectation:
    """Creates a wait."""
    return await db.create_wait(request)


@router.patch("/{id}")
async def update_wait(db: Writer, id: str, request: UpdateExpectationRequest) -> Expectation:
    """Updates a wait, stored or derived; naming a parent moves it."""
    return await db.update_wait(node_id(id), request)


@router.delete("/{id}", status_code=204)
async def delete_wait(db: Writer, id: str) -> None:
    """Deletes a stored wait. A derived one is refused: it goes with its Task."""
    await db.delete_wait(node_id(id))


@router.post("/{id}/check/complete")
async def complete_wait_check(db: Writer, id: int) -> Expectation:
    """Marks a stored wait's check done."""
    return await db.complete_wait_check(id)


@router.post("/{id}/check/reopen")
async def reopen_wait_check(db: Writer, id: int, due_at: datetime) -> Expectation:
    """Reopens a stored wait's check, due again at ``due_at``."""
    return await db.reopen_wait_check(id, due_at)
