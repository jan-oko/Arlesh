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

from arlesh_api.dependencies import Reader, Writer, node_id
from arlesh_api.routes import make_router

router = make_router("/tasks", "tasks")


@router.get("/{id}")
async def get_task(db: Reader, id: int) -> TaskWithBlockers:
    """One stored Task, with what blocks it."""
    return await db.get_task(id)


@router.get("/{id}/dependencies")
async def get_task_dependencies(db: Reader, id: str) -> list[Dependency]:
    """What a Task comes after."""
    return await db.task_dependencies(node_id(id))


@router.get("/{id}/done-at")
async def get_task_done_at(db: Reader, id: str) -> datetime | None:
    """When a Task was done, or ``null`` if it is not."""
    return await db.task_done_at(node_id(id))


@router.post("", status_code=201)
async def create_task(db: Writer, request: CreateTaskRequest) -> Task:
    """Creates a Task."""
    return await db.create_task(request)


@router.patch("/{id}")
async def update_task(
    db: Writer, id: str, request: UpdateTaskRequest, confirmed: bool = False
) -> Task:
    """Updates a Task, stored or a Habit occurrence. A field left out is unchanged; ``null``
    clears it. Naming ``parent_type``, ``parent_id`` and ``position`` moves it.

    Completing an occurrence that still holds unfinished children is refused 422
    ``needs_confirmation``, naming them; send it again with ``?confirmed=true`` to go ahead.
    """
    return await db.update_task(node_id(id), request, confirmed=confirmed)


@router.delete("/{id}", status_code=204)
async def delete_task(db: Writer, id: str) -> None:
    """Deletes a Task and its subtree."""
    await db.delete_task(node_id(id))


@router.post("/{id}/status")
async def step_task_status(
    db: Writer, id: str, step: StatusStep, confirmed: bool = False
) -> StatusStepOutcome:
    """One status gesture: ``advance`` (a step of the cycle) or ``alt`` (pause, resume, or hand
    an Agentic Task back)."""
    return await db.step_task_status(node_id(id), step, confirmed=confirmed)


@router.post("/{id}/agentic/toggle")
async def toggle_task_agentic(db: Writer, id: str) -> Task:
    """Flips a Task between Agentic and not."""
    return await db.toggle_task_agentic(node_id(id))


@router.post("/{id}/dependencies", status_code=204)
async def add_task_dependency(db: Writer, id: str, dependency: Dependency) -> None:
    """Makes a Task come after a Task, Goal or wait. A cycle is refused."""
    await db.add_task_dependency(node_id(id), dependency)


@router.delete("/{id}/dependencies", status_code=204)
async def remove_task_dependency(db: Writer, id: str, dependency: Dependency) -> None:
    """Removes one of a Task's dependencies, named in the body as it was added."""
    await db.remove_task_dependency(node_id(id), dependency)


@router.put("/{id}/done-at", status_code=204)
async def set_task_done_at(db: Writer, id: str, at: datetime) -> None:
    """Corrects when a done Task was done."""
    await db.set_task_done_at(node_id(id), at)


@router.post("/{id}/duplicate", status_code=201)
async def duplicate_task(
    db: Writer, id: int, target_type: str, target_id: int, position: int
) -> Task:
    """Copies a Task and its subtree under a new parent."""
    return await db.duplicate_task(id, target_type, target_id, position)


@router.post("/{id}/convert-to-flow", status_code=201)
async def convert_task_to_flow(
    db: Writer, id: int, keep_dependencies: bool, map_scopes: bool
) -> Flow:
    """Turns a Task's subtree into a Flow."""
    return await db.convert_to_flow(
        "task", id, keep_dependencies=keep_dependencies, map_scopes=map_scopes
    )


@router.patch("/{id}/spawned-wait")
async def update_spawned_wait(
    db: Writer, id: int, request: UpdateSpawnedWaitRequest
) -> SpawnedWait:
    """Updates the wait an Asynchronous Task spawned."""
    return await db.update_spawned_wait(id, request)


@router.post("/{id}/spawned-wait/check/complete", status_code=204)
async def complete_spawned_wait_check(db: Writer, id: int) -> None:
    """Marks a spawned wait's check done."""
    await db.complete_spawned_wait_check(id)


@router.post("/{id}/spawned-wait/check/reopen", status_code=204)
async def reopen_spawned_wait_check(db: Writer, id: int, due_at: datetime) -> None:
    """Reopens a spawned wait's check, due again at ``due_at``."""
    await db.reopen_spawned_wait_check(id, due_at)
