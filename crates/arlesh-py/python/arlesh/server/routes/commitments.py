"""Commitments: one Commitment, its writes and its verdict."""

from __future__ import annotations

from arlesh.models import (
    Commitment,
    CreateCommitmentRequest,
    UpdateCommitmentRequest,
    VerdictPress,
)

from arlesh_api.dependencies import Reader, Writer, node_id
from arlesh_api.routes import make_router

router = make_router("/commitments", "commitments")


@router.get("/{id}")
async def get_commitment(db: Reader, id: int) -> Commitment:
    """One stored Commitment."""
    return await db.get_commitment(id)


@router.post("", status_code=201)
async def create_commitment(db: Writer, request: CreateCommitmentRequest) -> Commitment:
    """Creates a Commitment. One with no window of its own or above it is refused 422
    ``needs_time_scope``: send it again with a ``time_scope``."""
    return await db.create_commitment(request)


@router.patch("/{id}")
async def update_commitment(db: Writer, id: str, request: UpdateCommitmentRequest) -> Commitment:
    """Updates a Commitment; naming a parent moves it."""
    return await db.update_commitment(node_id(id), request)


@router.delete("/{id}", status_code=204)
async def delete_commitment(db: Writer, id: str) -> None:
    """Deletes a Commitment."""
    await db.delete_commitment(node_id(id))


@router.post("/{id}/verdict")
async def press_commitment_verdict(db: Writer, id: str, press: VerdictPress) -> Commitment:
    """A press of a verdict control: the cycle, Kept or Broken."""
    return await db.press_commitment_verdict(node_id(id), press)
