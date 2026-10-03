"""Goals: one Goal and its writes."""

from __future__ import annotations

from arlesh.models import CreateGoalRequest, Flow, Goal, UpdateGoalRequest

from arlesh_api.dependencies import Reader, Writer, node_id
from arlesh_api.routes import make_router

router = make_router("/goals", "goals")


@router.get("/{id}")
async def get_goal(db: Reader, id: int) -> Goal:
    """One stored Goal."""
    return await db.get_goal(id)


@router.post("", status_code=201)
async def create_goal(db: Writer, request: CreateGoalRequest) -> Goal:
    """Creates a Goal."""
    return await db.create_goal(request)


@router.patch("/{id}")
async def update_goal(
    db: Writer, id: str, request: UpdateGoalRequest, confirmed: bool = False
) -> Goal:
    """Updates a Goal; naming a parent moves it. Achieving an occurrence over unfinished
    children is refused 422 ``needs_confirmation`` until sent with ``?confirmed=true``."""
    return await db.update_goal(node_id(id), request, confirmed=confirmed)


@router.delete("/{id}", status_code=204)
async def delete_goal(db: Writer, id: str) -> None:
    """Deletes a Goal and its subtree."""
    await db.delete_goal(node_id(id))


@router.post("/{id}/duplicate", status_code=201)
async def duplicate_goal(
    db: Writer, id: int, target_type: str, target_id: int, position: int
) -> Goal:
    """Copies a Goal and its subtree under a new parent."""
    return await db.duplicate_goal(id, target_type, target_id, position)


@router.post("/{id}/convert-to-flow", status_code=201)
async def convert_goal_to_flow(
    db: Writer, id: int, keep_dependencies: bool, map_scopes: bool
) -> Flow:
    """Turns a Goal's subtree into a Flow."""
    return await db.convert_to_flow(
        "goal", id, keep_dependencies=keep_dependencies, map_scopes=map_scopes
    )
