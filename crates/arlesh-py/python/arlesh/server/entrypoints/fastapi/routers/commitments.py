"""Commitments: one Commitment, its writes and its verdict."""

from __future__ import annotations

from arlesh.models import (
    Commitment,
    CreateCommitmentRequest,
    UpdateCommitmentRequest,
    VerdictPress,
)
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter, node_id


class CommitmentsRouter(BoardRouter):
    """``/commitments``."""

    def _register_routes(self) -> None:
        self.get("/{id}")(self._get)
        self.post("", status_code=201)(self._create)
        self.patch("/{id}")(self._update)
        self.delete("/{id}", status_code=204)(self._delete)
        self.put("/{id}/archived")(self._set_archived)
        self.post("/{id}/verdict")(self._press_verdict)

    async def _get(self, id: int) -> Commitment:
        """One stored Commitment."""
        return await self._reader.get_commitment(id)

    async def _create(self, request: CreateCommitmentRequest) -> Commitment:
        """Creates a Commitment. One with no window of its own or above it is refused 422
        ``needs_time_scope``: send it again with a ``time_scope``."""
        return await (await self._writer()).create_commitment(request)

    async def _update(self, id: str, request: UpdateCommitmentRequest) -> Commitment:
        """Updates a Commitment; naming a parent moves it."""
        return await (await self._writer()).update_commitment(node_id(id), request)

    async def _delete(self, id: str) -> None:
        """Deletes a Commitment."""
        await (await self._writer()).delete_commitment(node_id(id))

    async def _set_archived(self, id: str, archived: bool) -> Commitment:
        """Archives a Commitment by hand, with everything beneath it, or puts it back in play."""
        return await (await self._writer()).set_commitment_archived(node_id(id), archived)

    async def _press_verdict(self, id: str, press: VerdictPress) -> Commitment:
        """A press of a verdict control: the cycle, Kept or Broken."""
        return await (await self._writer()).press_commitment_verdict(node_id(id), press)
