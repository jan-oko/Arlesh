"""Waits (Expectations): their writes and their checks."""

from __future__ import annotations

from datetime import datetime

from arlesh.models import CreateExpectationRequest, Expectation, UpdateExpectationRequest
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter, node_id


class WaitsRouter(BoardRouter):
    """``/waits``."""

    def _register_routes(self) -> None:
        self.post("", status_code=201)(self._create)
        self.patch("/{id}")(self._update)
        self.delete("/{id}", status_code=204)(self._delete)
        self.post("/{id}/check/complete")(self._complete_check)
        self.post("/{id}/check/reopen")(self._reopen_check)

    async def _create(self, request: CreateExpectationRequest) -> Expectation:
        """Creates a wait."""
        return await (await self._writer()).create_wait(request)

    async def _update(self, id: str, request: UpdateExpectationRequest) -> Expectation:
        """Updates a wait, stored or derived; naming a parent moves it."""
        return await (await self._writer()).update_wait(node_id(id), request)

    async def _delete(self, id: str) -> None:
        """Deletes a stored wait. A derived one is refused: it goes with its Task."""
        await (await self._writer()).delete_wait(node_id(id))

    async def _complete_check(self, id: int) -> Expectation:
        """Marks a stored wait's check done."""
        return await (await self._writer()).complete_wait_check(id)

    async def _reopen_check(self, id: int, due_at: datetime) -> Expectation:
        """Reopens a stored wait's check, due again at ``due_at``."""
        return await (await self._writer()).reopen_wait_check(id, due_at)
