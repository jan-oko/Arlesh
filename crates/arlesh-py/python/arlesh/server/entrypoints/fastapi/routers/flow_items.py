"""A Flow's items: its Goal and Task templates, their cycles and their order."""

from __future__ import annotations

from datetime import datetime

from arlesh.models import (
    CreateFlowItemRequest,
    FlowCommitment,
    FlowCycleInput,
    FlowExpectation,
    FlowGoal,
    FlowItemType,
    FlowTask,
    ForkedTemplate,
    Reconcile,
    UpdateFlowItemRequest,
)
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class FlowItemsRouter(BoardRouter):
    """``/flow-items``."""

    def _register_routes(self) -> None:
        self.post("/flow_goal", status_code=201)(self._create_goal)
        self.post("/flow_task", status_code=201)(self._create_task)
        self.post("/flow_commitment", status_code=201)(self._create_commitment)
        self.post("/flow_expectation", status_code=201)(self._create_wait)
        self.patch("/flow_goal/{id}")(self._update_goal)
        self.patch("/flow_task/{id}")(self._update_task)
        self.patch("/flow_commitment/{id}")(self._update_commitment)
        self.patch("/flow_expectation/{id}")(self._update_wait)
        self.delete("/{item_type}/{id}", status_code=204)(self._delete)
        self.put("/{item_type}/{id}/cycles")(self._set_cycles)
        self.delete(
            "/{item_type}/{id}/dependencies/{depends_on_type}/{depends_on_id}", status_code=204
        )(self._remove_dependency)
        self.post("/{item_type}/{id}/duplicate", status_code=201)(self._duplicate)

    async def _create_goal(self, request: CreateFlowItemRequest) -> FlowGoal:
        """Creates a Goal item in a Flow."""
        return await (await self._writer()).create_flow_goal(request)

    async def _create_task(self, request: CreateFlowItemRequest) -> FlowTask:
        """Creates a Task item in a Flow."""
        return await (await self._writer()).create_flow_task(request)

    async def _create_commitment(self, request: CreateFlowItemRequest) -> FlowCommitment:
        """Creates a Commitment item in a Flow."""
        return await (await self._writer()).create_flow_commitment(request)

    async def _create_wait(self, request: CreateFlowItemRequest) -> FlowExpectation:
        """Creates a wait item in a Flow."""
        return await (await self._writer()).create_flow_wait(request)

    async def _update_goal(self, id: int, request: UpdateFlowItemRequest) -> FlowGoal:
        """Updates a Flow's Goal item."""
        return await (await self._writer()).update_flow_goal(id, request)

    async def _update_task(self, id: int, request: UpdateFlowItemRequest) -> FlowTask:
        """Updates a Flow's Task item."""
        return await (await self._writer()).update_flow_task(id, request)

    async def _update_commitment(self, id: int, request: UpdateFlowItemRequest) -> FlowCommitment:
        """Updates a Flow's Commitment item."""
        return await (await self._writer()).update_flow_commitment(id, request)

    async def _update_wait(self, id: int, request: UpdateFlowItemRequest) -> FlowExpectation:
        """Updates a Flow's wait item."""
        return await (await self._writer()).update_flow_wait(id, request)

    async def _delete(self, item_type: FlowItemType, id: int) -> None:
        """Deletes a Flow item."""
        await (await self._writer()).delete_flow_item(item_type, id)

    async def _set_cycles(
        self,
        item_type: FlowItemType,
        id: int,
        flow_id: int,
        cycles: list[FlowCycleInput],
        reconcile: Reconcile | None = None,
        now: datetime | None = None,
    ) -> ForkedTemplate | None:
        """Sets a Flow item's cycles. Orphaning what Habit iterations recorded is refused 422
        ``needs_confirmation`` until sent with ``?reconcile=`` saying how to settle it."""
        return await (await self._writer()).set_flow_item_cycles(
            flow_id, item_type, id, cycles, reconcile=reconcile, now=now
        )

    async def _remove_dependency(
        self,
        item_type: FlowItemType,
        id: int,
        depends_on_type: FlowItemType,
        depends_on_id: int,
    ) -> None:
        """Removes a dependency between Flow items."""
        await (await self._writer()).remove_flow_dependency(
            item_type, id, depends_on_type, depends_on_id
        )

    async def _duplicate(
        self, item_type: FlowItemType, id: int, parent_type: str, parent_id: int, position: int
    ) -> int:
        """Copies a Flow item under a new parent in its Flow, and answers the copy's id."""
        return await (await self._writer()).duplicate_flow_item(
            item_type, id, parent_type, parent_id, position
        )
