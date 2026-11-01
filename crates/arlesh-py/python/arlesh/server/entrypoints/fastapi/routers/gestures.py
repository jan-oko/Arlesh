"""The gesture operations: each gesture the app makes over several nodes, as one request — one
transaction, one Gesture, one undo step on the calling client's stack."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from arlesh.models import GestureName, GestureNode, StepEntry
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class GesturesRouter(BoardRouter):
    """``/gestures``."""

    def _register_routes(self) -> None:
        self.post("/delete-nodes", status_code=204)(self._delete_nodes)
        # One route per gesture, each running only the writes its gesture makes.
        for name in GestureName:
            self.post(f"/{name.value}", name=f"gesture_{name.name}")(self._gesture(name))

    async def _delete_nodes(self, nodes: list[GestureNode]) -> None:
        """Deletes every node in the body, all or nothing: a multi-selection, or a subtree."""
        await (await self._writer()).delete_nodes(nodes)

    def _gesture(self, name: GestureName) -> Callable[[list[StepEntry]], Awaitable[list[Any]]]:
        async def run(steps: list[StepEntry]) -> list[Any]:
            """Runs the gesture's writes, in the body's order, as one transaction and one undo
            step, answering each write's result. A write marked ``may_be_refused`` that is
            refused is taken back and answered ``{"refused": <error>}``; any other refusal
            refuses the whole gesture."""
            return await (await self._writer()).run_gesture(name, steps)

        run.__name__ = f"gesture_{name.name}"
        return run
