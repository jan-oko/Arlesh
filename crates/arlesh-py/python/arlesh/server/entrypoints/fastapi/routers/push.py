"""``/push`` and ``/devices/current/push``: a device registers its FCM token, so the server can
notify it. See ``docs/spec/notifications.md``."""

from __future__ import annotations

from contextvars import ContextVar

from fastapi import APIRouter
from pydantic import BaseModel, Field

from arlesh.server.business_logic.notifier import Notifier
from arlesh.server.entrypoints.fastapi.exception_handling.exception_handlers import (
    ERROR_RESPONSES,
)
from arlesh.server.entrypoints.fastapi.routers.base import WireRoute


class PushState(BaseModel):
    """Whether the server can push."""

    enabled: bool
    """Whether it has FCM credentials. Registering works either way; nothing is sent without."""
    project_id: str | None = None
    """The Firebase project it sends from, when enabled."""


class PushRegistration(BaseModel):
    """What a device registers."""

    fcm_token: str = Field(min_length=1, max_length=4096)
    """The device's FCM registration token."""


class Registered(BaseModel):
    """What registering answers."""

    new: bool
    """Whether the device had no registration before. A new one hears only of what happens after."""


class PushRouter(APIRouter):
    """The push routes, behind the bearer token: a device registers under its own client."""

    def __init__(self, notifier: Notifier, client_context: ContextVar[str]) -> None:
        super().__init__(tags=["push"], responses=ERROR_RESPONSES, route_class=WireRoute)
        self._notifier = notifier
        self._client = client_context
        self.get("/push")(self._state)
        self.put("/devices/current/push")(self._register)
        self.delete("/devices/current/push", status_code=204)(self._unregister)

    async def _state(self) -> PushState:
        """Whether this server can push, and from which Firebase project."""
        return PushState(enabled=self._notifier.enabled, project_id=self._notifier.project_id)

    async def _register(self, body: PushRegistration) -> Registered:
        """Registers the asking device's FCM token, replacing its last."""
        return Registered(new=await self._notifier.register(self._client.get(), body.fcm_token))

    async def _unregister(self) -> None:
        """Drops the asking device's registration; it is sent nothing more."""
        await self._notifier.unregister(self._client.get())
