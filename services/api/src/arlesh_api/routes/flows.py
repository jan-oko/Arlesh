"""Flows and Habits: their writes, their items, and the composite operations over them."""

from __future__ import annotations

from datetime import datetime

from arlesh.models import (
    CreateFlowItemRequest,
    CreateFlowRequest,
    Flow,
    FlowCycleInput,
    FlowGoal,
    FlowItemType,
    FlowRecurrence,
    FlowTask,
    ForkedTemplate,
    MaterializedFlow,
    Reconcile,
    SetRecurrenceRequest,
    StartFlowRequest,
    UpdateFlowItemRequest,
    UpdateFlowRequest,
)

from arlesh_api.dependencies import Reader, Writer
from arlesh_api.routes import make_router

router = make_router("/flows", "flows")
items = make_router("/flow-items", "flows")


@router.get("/{id}")
async def get_flow(db: Reader, id: int) -> Flow:
    """One Flow or Habit template."""
    return await db.get_flow(id)


@router.post("", status_code=201)
async def create_flow(db: Writer, request: CreateFlowRequest) -> Flow:
    """Creates a Flow."""
    return await db.create_flow(request)


@router.patch("/{id}")
async def update_flow(db: Writer, id: int, request: UpdateFlowRequest) -> Flow:
    """Updates a Flow; naming a parent moves it."""
    return await db.update_flow(id, request)


@router.delete("/{id}", status_code=204)
async def delete_flow(db: Writer, id: int) -> None:
    """Deletes a Flow and its items."""
    await db.delete_flow(id)


@router.post("/{id}/start", status_code=201)
async def start_flow(db: Writer, id: int, request: StartFlowRequest) -> MaterializedFlow:
    """Starts a Flow: copies it into a real subtree under a target, in one transaction."""
    return await db.start_flow(id, request)


@router.put("/{id}/recurrence")
async def set_flow_recurrence(
    db: Writer, id: int, request: SetRecurrenceRequest
) -> FlowRecurrence:
    """Makes a Flow a Habit, or changes its Recurrence."""
    return await db.set_flow_recurrence(id, request)


@router.delete("/{id}/recurrence", status_code=204)
async def delete_flow_recurrence(db: Writer, id: int) -> None:
    """Takes a Habit's Recurrence away, leaving a plain Flow."""
    await db.delete_flow_recurrence(id)


@router.delete("/{id}/habit-modifications", status_code=204)
async def clear_habit_modifications(db: Writer, id: int) -> None:
    """Drops every edit made to a Habit's occurrences."""
    await db.clear_habit_modifications(id)


@router.post("/{id}/fork", status_code=201)
async def fork_flow(db: Writer, id: int, now: datetime | None = None) -> Flow:
    """Archives a Habit and forks a fresh copy of it."""
    return await db.fork_flow(id, now=now)


@router.post("/{id}/duplicate", status_code=201)
async def duplicate_flow(
    db: Writer, id: int, parent_type: str, parent_id: int, position: int
) -> Flow:
    """Copies a Flow under a new parent."""
    return await db.duplicate_flow(id, parent_type, parent_id, position)


@router.post("/{id}/dependencies", status_code=204)
async def add_flow_dependency(
    db: Writer,
    id: int,
    dependent_type: FlowItemType,
    dependent_id: int,
    depends_on_type: FlowItemType,
    depends_on_id: int,
) -> None:
    """Makes one of the Flow's items come after another."""
    await db.add_flow_dependency(id, dependent_type, dependent_id, depends_on_type, depends_on_id)


@items.post("/flow_goal", status_code=201)
async def create_flow_goal(db: Writer, request: CreateFlowItemRequest) -> FlowGoal:
    """Creates a Goal item in a Flow."""
    return await db.create_flow_goal(request)


@items.post("/flow_task", status_code=201)
async def create_flow_task(db: Writer, request: CreateFlowItemRequest) -> FlowTask:
    """Creates a Task item in a Flow."""
    return await db.create_flow_task(request)


@items.patch("/flow_goal/{id}")
async def update_flow_goal(db: Writer, id: int, request: UpdateFlowItemRequest) -> FlowGoal:
    """Updates a Flow's Goal item."""
    return await db.update_flow_goal(id, request)


@items.patch("/flow_task/{id}")
async def update_flow_task(db: Writer, id: int, request: UpdateFlowItemRequest) -> FlowTask:
    """Updates a Flow's Task item."""
    return await db.update_flow_task(id, request)


@items.delete("/{item_type}/{id}", status_code=204)
async def delete_flow_item(db: Writer, item_type: FlowItemType, id: int) -> None:
    """Deletes a Flow item."""
    await db.delete_flow_item(item_type, id)


@items.put("/{item_type}/{id}/cycles")
async def set_flow_item_cycles(
    db: Writer,
    item_type: FlowItemType,
    id: int,
    flow_id: int,
    cycles: list[FlowCycleInput],
    reconcile: Reconcile | None = None,
    now: datetime | None = None,
) -> ForkedTemplate | None:
    """Sets a Flow item's cycles. Orphaning what Habit iterations recorded is refused 422
    ``needs_confirmation`` until sent with ``?reconcile=`` saying how to settle it."""
    return await db.set_flow_item_cycles(
        flow_id, item_type, id, cycles, reconcile=reconcile, now=now
    )


@items.delete(
    "/{item_type}/{id}/dependencies/{depends_on_type}/{depends_on_id}", status_code=204
)
async def remove_flow_dependency(
    db: Writer,
    item_type: FlowItemType,
    id: int,
    depends_on_type: FlowItemType,
    depends_on_id: int,
) -> None:
    """Removes a dependency between Flow items."""
    await db.remove_flow_dependency(item_type, id, depends_on_type, depends_on_id)


@items.post("/{item_type}/{id}/duplicate", status_code=201)
async def duplicate_flow_item(
    db: Writer,
    item_type: FlowItemType,
    id: int,
    parent_type: str,
    parent_id: int,
    position: int,
) -> int:
    """Copies a Flow item under a new parent in its Flow, and answers the copy's id."""
    return await db.duplicate_flow_item(item_type, id, parent_type, parent_id, position)
