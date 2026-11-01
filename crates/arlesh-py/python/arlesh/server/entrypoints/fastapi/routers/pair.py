"""``/pair``: the two routes a new device uses before it has a token, so the only ones open
without one. Rate limited per address; the rest of the pairing is behind the token, in
:mod:`~arlesh.server.entrypoints.fastapi.routers.devices`."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel

from arlesh.server.business_logic.pairing import Pairing
from arlesh.server.entrypoints.fastapi.exception_handling.exception_handlers import (
    ERROR_RESPONSES,
)
from arlesh.server.entrypoints.fastapi.rate_limit import RateLimiter

PAIRS_PER_WINDOW = 10
WINDOW_SECONDS = 600.0


class PairRequest(BaseModel):
    """What ``POST /pair`` takes."""

    name: str | None = None
    """The device's suggested name; reduced to a client name (letters, digits, ``.``, ``_``,
    ``-``). Defaults to ``device``."""


class PairStarted(BaseModel):
    """What ``POST /pair`` answers."""

    id: str
    """The poll's secret: keep it, show it to nobody."""
    pin: str
    """Six digits, to show large. Valid for ten minutes, usable once."""
    name: str
    """The suggested name as the server reduced it."""
    expires_at: datetime


class PollRequest(BaseModel):
    """What ``POST /pair/poll`` takes."""

    id: str
    pin: str


class PairPolled(BaseModel):
    """What ``POST /pair/poll`` answers."""

    status: str
    """``pending``, or ``approved``."""
    name: str | None = None
    """The name the device holds (``approved`` only)."""
    token: str | None = None
    """The device's bearer token (``approved`` only). Answered once, by exactly one poll."""


class PairRouter(APIRouter):
    """``/pair``."""

    def __init__(
        self, pairing: Pairing, limiter: RateLimiter | None = None
    ) -> None:
        super().__init__(tags=["pairing"], responses=ERROR_RESPONSES)
        self._pairing = pairing
        self._limiter = limiter or RateLimiter(PAIRS_PER_WINDOW, WINDOW_SECONDS)
        self.post("", status_code=201)(self._start)
        self.post("/poll")(self._poll)

    async def _start(self, request: Request, body: PairRequest | None = None) -> PairStarted:
        """Asks to be paired: answers a PIN for someone signed in to approve."""
        self._limiter.hit(request.client.host if request.client else "unknown")
        started = self._pairing.start(body.name if body else None)
        return PairStarted(
            id=started.id, pin=started.pin, name=started.name, expires_at=started.expires
        )

    async def _poll(self, body: PollRequest) -> PairPolled:
        """Asks whether the PIN was approved. When it was, answers the device's token, once."""
        polled = self._pairing.poll(body.id, body.pin)
        return PairPolled(status=polled.status, name=polled.name, token=polled.token)
