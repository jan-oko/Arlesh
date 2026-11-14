"""The agents: who is attached, where each Claim stands, and the PIN that lets one attach.

Behind a device token (a signed-in client). An agent holds only the connect token and its own agent
token, neither of which reaches these routes, so **an agent cannot approve another agent**.
"""

from __future__ import annotations

from pydantic import BaseModel

from arlesh.models import AgentAction, AgentsOverview, IssuedPin
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class AccountLock(BaseModel):
    """What ``PUT /agent-accounts/lock`` takes."""

    label: str
    """The account's label."""
    locked: bool
    """Whether the lock is on."""


class AgentsRouter(BoardRouter):
    """``/agents``."""

    def _register_routes(self) -> None:
        self.get("")(self._list)
        self.post("/pins")(self._pin)
        self.post("/{id}/action", status_code=204)(self._act)

    async def _list(self) -> AgentsOverview:
        """Every agent and account, with where each Claim stands and why an agent is at capacity."""
        return await self._reader.list_agents()

    async def _pin(self) -> IssuedPin:
        """A one-time PIN to give an agent, so it can attach (`arlesh_agents.attach`)."""
        return await (await self._writer()).issue_agent_pin()

    async def _act(self, id: int, action: AgentAction) -> None:
        """Pauses, resumes or releases an agent's Claim, locks it, or removes it."""
        await (await self._writer()).apply_agent_action(id, action)


class AgentAccountsRouter(BoardRouter):
    """``/agent-accounts``."""

    def _register_routes(self) -> None:
        self.put("/lock", status_code=204)(self._lock)

    async def _lock(self, body: AccountLock) -> None:
        """Locks or unlocks a whole account by hand."""
        await (await self._writer()).set_agent_account_locked(body.label, body.locked)
