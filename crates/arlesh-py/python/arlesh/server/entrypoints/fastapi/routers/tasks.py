"""Tasks: one Task, its writes, its status gesture, its dependencies and its spawned wait."""

from __future__ import annotations

from datetime import datetime

from arlesh.models import (
    CreateTaskRequest,
    Dependency,
    Flow,
    SpawnedWait,
    StatusStep,
    StatusStepOutcome,
    Task,
    TaskWithBlockers,
    UpdateSpawnedWaitRequest,
    UpdateTaskRequest,
)
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter, node_id


class TasksRouter(BoardRouter):
    """``/tasks``."""

    def _register_routes(self) -> None:
        self.get("/{id}")(self._get)
        self.get("/{id}/dependencies")(self._dependencies)
        self.get("/{id}/done-at")(self._done_at)
        self.post("", status_code=201)(self._create)
        self.patch("/{id}")(self._update)
        self.delete("/{id}", status_code=204)(self._delete)
        self.post("/{id}/status")(self._step_status)
        self.post("/{id}/agentic/toggle")(self._toggle_agentic)
        self.post("/{id}/dependencies", status_code=204)(self._add_dependency)
        self.delete("/{id}/dependencies", status_code=204)(self._remove_dependency)
        self.put("/{id}/done-at", status_code=204)(self._set_done_at)
        self.post("/{id}/duplicate", status_code=201)(self._duplicate)
        self.post("/{id}/convert-to-flow", status_code=201)(self._convert_to_flow)
        self.patch("/{id}/spawned-wait")(self._update_spawned_wait)
        self.post("/{id}/spawned-wait/check/complete", status_code=204)(self._complete_check)
        self.post("/{id}/spawned-wait/check/reopen", status_code=204)(self._reopen_check)

    async def _get(self, id: int) -> TaskWithBlockers:
        """One stored Task, with what blocks it."""
        return await self._reader.get_task(id)

    async def _dependencies(self, id: str) -> list[Dependency]:
        """What a Task comes after."""
        return await self._reader.task_dependencies(node_id(id))

    async def _done_at(self, id: str) -> datetime | None:
        """When a Task was done, or ``null`` if it is not."""
        return await self._reader.task_done_at(node_id(id))

    async def _create(self, request: CreateTaskRequest) -> Task:
        """Creates a Task."""
        return await (await self._writer()).create_task(request)

    async def _update(self, id: str, request: UpdateTaskRequest, confirmed: bool = False) -> Task:
        """Updates a Task, stored or a Habit occurrence. A field left out is unchanged; ``null``
        clears it. Naming ``parent_type``, ``parent_id`` and ``position`` moves it.

        Completing an occurrence that still holds unfinished children is refused 422
        ``needs_confirmation``, naming them; send it again with ``?confirmed=true`` to go ahead.
        """
        return await (await self._writer()).update_task(node_id(id), request, confirmed=confirmed)

    async def _delete(self, id: str) -> None:
        """Deletes a Task and its subtree."""
        await (await self._writer()).delete_task(node_id(id))

    async def _step_status(
        self, id: str, step: StatusStep, confirmed: bool = False
    ) -> StatusStepOutcome:
        """One status gesture: ``advance`` (a step of the cycle) or ``alt`` (pause, resume, or
        hand an Agentic Task back)."""
        return await (await self._writer()).step_task_status(node_id(id), step, confirmed=confirmed)

    async def _toggle_agentic(self, id: str) -> Task:
        """Flips a Task between Agentic and not."""
        return await (await self._writer()).toggle_task_agentic(node_id(id))

    async def _add_dependency(self, id: str, dependency: Dependency) -> None:
        """Makes a Task come after a Task, Goal or wait. A cycle is refused."""
        await (await self._writer()).add_task_dependency(node_id(id), dependency)

    async def _remove_dependency(self, id: str, dependency: Dependency) -> None:
        """Removes one of a Task's dependencies, named in the body as it was added."""
        await (await self._writer()).remove_task_dependency(node_id(id), dependency)

    async def _set_done_at(self, id: str, at: datetime) -> None:
        """Corrects when a done Task was done."""
        await (await self._writer()).set_task_done_at(node_id(id), at)

    async def _duplicate(self, id: int, target_type: str, target_id: int, position: int) -> Task:
        """Copies a Task and its subtree under a new parent."""
        return await (await self._writer()).duplicate_task(id, target_type, target_id, position)

    async def _convert_to_flow(self, id: int, keep_dependencies: bool, map_scopes: bool) -> Flow:
        """Turns a Task's subtree into a Flow."""
        return await (await self._writer()).convert_to_flow(
            "task", id, keep_dependencies=keep_dependencies, map_scopes=map_scopes
        )

    async def _update_spawned_wait(self, id: int, request: UpdateSpawnedWaitRequest) -> SpawnedWait:
        """Updates the wait an Asynchronous Task spawned."""
        return await (await self._writer()).update_spawned_wait(id, request)

    async def _complete_check(self, id: int) -> None:
        """Marks a spawned wait's check done."""
        await (await self._writer()).complete_spawned_wait_check(id)

    async def _reopen_check(self, id: int, due_at: datetime) -> None:
        """Reopens a spawned wait's check, due again at ``due_at``."""
        await (await self._writer()).reopen_spawned_wait_check(id, due_at)
