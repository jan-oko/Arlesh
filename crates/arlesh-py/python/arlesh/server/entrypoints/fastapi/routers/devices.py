"""``/devices`` and ``/pairings``: the signed-in side of pairing. List the devices, revoke one,
and approve a device that is showing a PIN."""

from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel

from arlesh.server.business_logic.pairing import Pairing, PairingRefused
from arlesh.server.entrypoints.fastapi.exception_handling.exception_handlers import (
    ERROR_RESPONSES,
)
from arlesh.server.entrypoints.fastapi.routers.base import WireRoute
from arlesh.server.ports.tokens.token_store import TokenStore, UnknownClient


class Device(BaseModel):
    """A device holding a token."""

    name: str
    created_at: datetime
    last_seen_at: datetime | None = None
    """When it last used its token (to the minute), or absent if it has not since this was kept."""
    current: bool
    """Whether this is the device asking: the one that cannot be revoked."""


class WaitingDevice(BaseModel):
    """A device showing a PIN."""

    pin: str
    name: str
    """The name it suggested, which the approver may change."""
    expires_at: datetime


class Approval(BaseModel):
    """What ``POST /pairings/{pin}/approve`` takes."""

    name: str | None = None
    """The name for the device; its suggested name if left out."""


class Approved(BaseModel):
    """What approving answers."""

    name: str
    """The name the device will hold: the one asked for, with ``-2``, ``-3`` … if it was taken."""


class DevicesRouter(APIRouter):
    """``/devices`` (behind the token) and ``/pairings`` (the same)."""

    def __init__(
        self, tokens: TokenStore, pairing: Pairing, client_context: ContextVar[str]
    ) -> None:
        super().__init__(tags=["devices"], responses=ERROR_RESPONSES, route_class=WireRoute)
        self._tokens = tokens
        self._pairing = pairing
        self._client = client_context
        self.get("/devices")(self._list)
        self.delete("/devices/{name}", status_code=204)(self._revoke)
        self.get("/pairings/{pin}")(self._waiting)
        self.post("/pairings/{pin}/approve")(self._approve)

    async def _list(self) -> list[Device]:
        """Every device holding a token."""
        current = self._client.get()
        return [
            Device(
                name=issued.client,
                created_at=issued.created,
                last_seen_at=issued.last_seen,
                current=issued.client == current,
            )
            for issued in self._tokens.issued()
        ]

    async def _revoke(self, name: str) -> None:
        """Revokes a device's token, which stops working at once. Not the asking device's own."""
        if name == self._client.get():
            raise PairingRefused(
                "current_device", "a device cannot revoke itself; revoke it from another device"
            )
        try:
            self._tokens.revoke(name)
        except UnknownClient:
            raise PairingRefused("unknown_device", f"no device is called {name}") from None

    async def _waiting(self, pin: str) -> WaitingDevice:
        """The device waiting with this PIN: the name it suggests."""
        found = self._pairing.lookup(pin)
        return WaitingDevice(pin=found.pin, name=found.name, expires_at=found.expires)

    async def _approve(self, pin: str, body: Approval | None = None) -> Approved:
        """Approves the device waiting with this PIN, under a name."""
        return Approved(name=self._pairing.approve(pin, body.name if body else None))
