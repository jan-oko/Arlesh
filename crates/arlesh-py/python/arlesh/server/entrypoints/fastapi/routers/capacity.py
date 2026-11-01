"""The agent capacity lock, on the server so every device and every agent sees the same one."""

from __future__ import annotations

from arlesh.models import CapacityState
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class CapacityRouter(BoardRouter):
    """``/capacity``."""

    def _register_routes(self) -> None:
        self.get("")(self._get)
        self.put("")(self._set)

    async def _get(self) -> CapacityState:
        """The lock as it stands. While it is on, every Agentic Task not yet done is blocked."""
        return await self._reader.agent_capacity()

    async def _set(self, state: CapacityState) -> CapacityState:
        """Sets the lock on or off. Every device hears it as a change to the board."""
        return await (await self._writer()).set_agent_capacity(state.at_capacity)
