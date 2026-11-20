"""Flows and Habits: their writes, and the composite operations over them."""

from __future__ import annotations

from datetime import date, datetime

from arlesh.models import (
    CreateFlowRequest,
    Flow,
    FlowGoal,
    FlowItemType,
    FlowOrigin,
    FlowRecurrence,
    FlowTask,
    MaterializedFlow,
    SetRecurrenceRequest,
    StartFlowRequest,
    TargetRef,
    UpdateFlowRequest,
)
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class FlowsRouter(BoardRouter):
    """``/flows``."""

    def _register_routes(self) -> None:
        self.get("")(self._list)
        self.get("/instance-nodes")(self._instance_nodes)
        self.post("/origins")(self._origins)
        self.post("/scope-valid-targets")(self._scope_valid_targets)
        self.get("/{id}")(self._get)
        self.get("/{id}/goals")(self._goals)
        self.get("/{id}/tasks")(self._tasks)
        self.get("/{id}/recurrence")(self._recurrence)
        self.get("/{id}/completion-count")(self._completion_count)
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

    async def _get(self, id: str) -> Flow:
        """One Flow or Habit template."""
        return await self._reader.get_flow(id)

    async def _create(self, request: CreateFlowRequest) -> Flow:
        """Creates a Flow."""
        return await (await self._writer()).create_flow(request)

    async def _update(self, id: str, request: UpdateFlowRequest) -> Flow:
        """Updates a Flow; naming a parent moves it."""
        return await (await self._writer()).update_flow(id, request)

    async def _delete(self, id: str) -> None:
        """Deletes a Flow and its items."""
        await (await self._writer()).delete_flow(id)

    async def _start(self, id: str, request: StartFlowRequest) -> MaterializedFlow:
        """Starts a Flow: copies it into a real subtree under a target, in one transaction."""
        return await (await self._writer()).start_flow(id, request)

    async def _set_recurrence(self, id: str, request: SetRecurrenceRequest) -> FlowRecurrence:
        """Makes a Flow a Habit, or changes its Recurrence."""
        return await (await self._writer()).set_flow_recurrence(id, request)

    async def _delete_recurrence(self, id: str) -> None:
        """Takes a Habit's Recurrence away, leaving a plain Flow."""
        await (await self._writer()).delete_flow_recurrence(id)

    async def _clear_modifications(self, id: str) -> None:
        """Drops every edit made to a Habit's occurrences."""
        await (await self._writer()).clear_habit_modifications(id)

    async def _fork(self, id: str, now: datetime | None = None) -> Flow:
        """Archives a Habit and forks a fresh copy of it."""
        return await (await self._writer()).fork_flow(id, now=now)

    async def _duplicate(self, id: str, parent_type: str, parent_id: str, position: int) -> Flow:
        """Copies a Flow under a new parent."""
        return await (await self._writer()).duplicate_flow(id, parent_type, parent_id, position)

    async def _add_dependency(
        self,
        id: str,
        dependent_type: FlowItemType,
        dependent_id: str,
        depends_on_type: FlowItemType,
        depends_on_id: str,
    ) -> None:
        """Makes one of the Flow's items come after another."""
        await (await self._writer()).add_flow_dependency(
            id, dependent_type, dependent_id, depends_on_type, depends_on_id
        )

    async def _list(self) -> list[Flow]:
        """Every Flow and Habit template."""
        return await self._reader.list_flows()

    async def _instance_nodes(self) -> list[TargetRef]:
        """Every node a started Flow produced."""
        return await self._reader.list_flow_instance_nodes()

    async def _origins(self, nodes: list[TargetRef]) -> list[FlowOrigin]:
        """Which Flow, if any, each node was started from. Writes nothing."""
        return await self._reader.flow_origins(nodes)

    async def _scope_valid_targets(
        self,
        candidates: list[TargetRef],
        duration_n: int | None = None,
        duration_kind: str | None = None,
        anchor_date: date | None = None,
    ) -> list[TargetRef]:
        """Which of ``candidates`` (the body) a Flow of the given duration may be started under.
        Writes nothing."""
        return await self._reader.scope_valid_flow_targets(
            candidates,
            duration_n=duration_n,
            duration_kind=duration_kind,
            anchor_date=anchor_date,
        )

    async def _goals(self, id: str) -> list[FlowGoal]:
        """The Flow's Goal items."""
        return await self._reader.list_flow_goals(id)

    async def _tasks(self, id: str) -> list[FlowTask]:
        """The Flow's Task items."""
        return await self._reader.list_flow_tasks(id)

    async def _recurrence(self, id: str) -> FlowRecurrence | None:
        """The Habit's recurrence, or ``null`` for a Flow without one."""
        return await self._reader.get_flow_recurrence(id)

    async def _completion_count(self, id: str) -> int:
        """How many of the Habit's occurrences are complete."""
        return await self._reader.habit_completion_count(id)
