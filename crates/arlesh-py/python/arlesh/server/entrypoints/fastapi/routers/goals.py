"""Goals: one Goal and its writes."""

from __future__ import annotations

from arlesh.models import CreateGoalRequest, DuplicatedGoal, Flow, Goal, UpdateGoalRequest
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter, node_id


class GoalsRouter(BoardRouter):
    """``/goals``."""

    def _register_routes(self) -> None:
        self.get("/{id}")(self._get)
        self.post("", status_code=201)(self._create)
        self.patch("/{id}")(self._update)
        self.delete("/{id}", status_code=204)(self._delete)
        self.post("/{id}/duplicate", status_code=201)(self._duplicate)
        self.post("/{id}/convert-to-flow", status_code=201)(self._convert_to_flow)

    async def _get(self, id: int) -> Goal:
        """One stored Goal."""
        return await self._reader.get_goal(id)

    async def _create(self, request: CreateGoalRequest) -> Goal:
        """Creates a Goal."""
        return await (await self._writer()).create_goal(request)

    async def _update(self, id: str, request: UpdateGoalRequest, confirmed: bool = False) -> Goal:
        """Updates a Goal; naming a parent moves it. Achieving an occurrence over unfinished
        children is refused 422 ``needs_confirmation`` until sent with ``?confirmed=true``."""
        return await (await self._writer()).update_goal(node_id(id), request, confirmed=confirmed)

    async def _delete(self, id: str) -> None:
        """Deletes a Goal and its subtree."""
        await (await self._writer()).delete_goal(node_id(id))

    async def _duplicate(
        self, id: int, target_type: str, target_id: int, position: int
    ) -> DuplicatedGoal:
        """Copies a Goal and its subtree under a new parent."""
        return await (await self._writer()).duplicate_goal(id, target_type, target_id, position)

    async def _convert_to_flow(self, id: int, keep_dependencies: bool, map_scopes: bool) -> Flow:
        """Turns a Goal's subtree into a Flow."""
        return await (await self._writer()).convert_to_flow(
            "goal", id, keep_dependencies=keep_dependencies, map_scopes=map_scopes
        )
