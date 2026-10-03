"""Flows and Habits: their writes, and the composite operations over them."""

from __future__ import annotations

from datetime import datetime

from arlesh.models import (
    CreateFlowRequest,
    Flow,
    FlowItemType,
    FlowRecurrence,
    MaterializedFlow,
    SetRecurrenceRequest,
    StartFlowRequest,
    UpdateFlowRequest,
)
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class FlowsRouter(BoardRouter):
    """``/flows``."""

    def _register_routes(self) -> None:
        self.get("/{id}")(self._get)
        self.post("", status_code=201)(self._create)
        self.patch("/{id}")(self._update)
        self.delete("/{id}", status_code=204)(self._delete)
        self.post("/{id}/start", status_code=201)(self._start)
        self.put("/{id}/recurrence")(self._set_recurrence)
        self.delete("/{id}/recurrence", status_code=204)(self._delete_recurrence)
        self.delete("/{id}/habit-modifications", status_code=204)(self._clear_modifications)
        self.post("/{id}/fork", status_code=201)(self._fork)
        self.post("/{id}/duplicate", status_code=201)(self._duplicate)
        self.post("/{id}/dependencies", status_code=204)(self._add_dependency)

    async def _get(self, id: int) -> Flow:
        """One Flow or Habit template."""
        return await self._reader.get_flow(id)

    async def _create(self, request: CreateFlowRequest) -> Flow:
        """Creates a Flow."""
        return await (await self._writer()).create_flow(request)

    async def _update(self, id: int, request: UpdateFlowRequest) -> Flow:
        """Updates a Flow; naming a parent moves it."""
        return await (await self._writer()).update_flow(id, request)

    async def _delete(self, id: int) -> None:
        """Deletes a Flow and its items."""
        await (await self._writer()).delete_flow(id)

    async def _start(self, id: int, request: StartFlowRequest) -> MaterializedFlow:
        """Starts a Flow: copies it into a real subtree under a target, in one transaction."""
        return await (await self._writer()).start_flow(id, request)

    async def _set_recurrence(self, id: int, request: SetRecurrenceRequest) -> FlowRecurrence:
        """Makes a Flow a Habit, or changes its Recurrence."""
        return await (await self._writer()).set_flow_recurrence(id, request)

    async def _delete_recurrence(self, id: int) -> None:
        """Takes a Habit's Recurrence away, leaving a plain Flow."""
        await (await self._writer()).delete_flow_recurrence(id)

    async def _clear_modifications(self, id: int) -> None:
        """Drops every edit made to a Habit's occurrences."""
        await (await self._writer()).clear_habit_modifications(id)

    async def _fork(self, id: int, now: datetime | None = None) -> Flow:
        """Archives a Habit and forks a fresh copy of it."""
        return await (await self._writer()).fork_flow(id, now=now)

    async def _duplicate(self, id: int, parent_type: str, parent_id: int, position: int) -> Flow:
        """Copies a Flow under a new parent."""
        return await (await self._writer()).duplicate_flow(id, parent_type, parent_id, position)

    async def _add_dependency(
        self,
        id: int,
        dependent_type: FlowItemType,
        dependent_id: int,
        depends_on_type: FlowItemType,
        depends_on_id: int,
    ) -> None:
        """Makes one of the Flow's items come after another."""
        await (await self._writer()).add_flow_dependency(
            id, dependent_type, dependent_id, depends_on_type, depends_on_id
        )
