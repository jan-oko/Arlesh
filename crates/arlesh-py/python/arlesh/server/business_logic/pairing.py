"""Device pairing: a new device asks for a PIN, someone signed in approves it, and the device's
next poll receives its own token, once. See ``docs/spec/client-mode.md``, *Pairing a device*.

The rules live here and the store only stores them, so they are tested without a database.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from collections.abc import Callable
from datetime import datetime, timedelta

from pydantic import BaseModel

from arlesh.server.ports.pairing.pairing_store import PairingRequest, PairingStore
from arlesh.server.ports.tokens.token_store import ClientAlreadyHasToken, TokenStore

PIN_LENGTH = 6
PIN_LIFETIME = timedelta(minutes=10)
"""How long a request lasts, approved or not."""
MAX_WRONG_ATTEMPTS = 5
"""The wrong PINs presented with one request's id before it is invalidated."""
MAX_PENDING = 20
"""The requests waiting for approval at once: a flood of ``POST /pair`` cannot fill the table."""
DEFAULT_NAME = "device"
MAX_NAME = 56
"""A client name is at most 64 characters; the rest is room for a ``-<n>`` suffix."""

_OUTSIDE_A_CLIENT_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class PairingRefused(Exception):
    """A pairing call the rules refuse. ``reason`` is the stable word the HTTP body carries."""

    def __init__(self, reason: str, message: str, **details: object) -> None:
        super().__init__(message)
        self.reason = reason
        self.details = details


class Started(BaseModel):
    """A request just made: what the device keeps and shows."""

    id: str
    """The poll's secret. Shown to nobody; the device keeps it."""
    pin: str
    name: str
    expires: datetime


class Pending(BaseModel):
    """A request waiting for approval, as the approver sees it."""

    pin: str
    name: str
    expires: datetime


class Polled(BaseModel):
    """The answer to a poll: still ``pending``, or ``approved`` with the token, this once."""

    status: str
    name: str | None = None
    token: str | None = None


def client_name(raw: str | None) -> str:
    """``raw`` as a client name: letters, digits, ``.``, ``_`` and ``-``, runs of anything else
    becoming one ``-``, cut to :data:`MAX_NAME`; ``device`` if nothing is left."""
    reduced = _OUTSIDE_A_CLIENT_NAME.sub("-", (raw or "").strip()).strip("-._")[:MAX_NAME]
    return reduced.strip("-._") or DEFAULT_NAME


def _digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


class Pairing:
    """The pairing rules over a store of requests and the token store they end in."""

    def __init__(
        self,
        pairs: PairingStore,
        tokens: TokenStore,
        clock: Callable[[], datetime] = lambda: datetime.now().replace(microsecond=0),
    ) -> None:
        self._pairs = pairs
        self._tokens = tokens
        self._clock = clock

    def start(self, suggested_name: str | None) -> Started:
        """Makes a request for a device that suggests ``suggested_name`` and answers its PIN."""
        now = self._now()
        if sum(1 for r in self._pairs.all() if r.approved_name is None) >= MAX_PENDING:
            raise PairingRefused(
                "too_many_pending", "too many devices are waiting to be approved; try again later"
            )
        name = client_name(suggested_name)
        for _ in range(50):
            secret = secrets.token_urlsafe(32)
            pin = f"{secrets.randbelow(10**PIN_LENGTH):0{PIN_LENGTH}d}"
            request = PairingRequest(
                id_sha256=_digest(secret),
                pin=pin,
                name=name,
                created=now,
                expires=now + PIN_LIFETIME,
            )
            if self._pairs.create(request):
                return Started(id=secret, pin=pin, name=name, expires=request.expires)
        raise PairingRefused("too_many_pending", "no PIN is free right now; try again later")

    def poll(self, secret: str, pin: str) -> Polled:
        """The device's poll. Presenting the wrong ``pin`` counts as an attempt against the
        request ``secret`` names; the :data:`MAX_WRONG_ATTEMPTS`-th invalidates it."""
        self._now()
        digest = _digest(secret)
        request = next((r for r in self._pairs.all() if r.id_sha256 == digest), None)
        if request is None:
            raise PairingRefused(
                "unknown_pairing", "this pairing request is unknown, used, expired or invalidated"
            )
        if not secrets.compare_digest(pin, request.pin):
            attempts = self._pairs.count_attempt(digest) or MAX_WRONG_ATTEMPTS
            if attempts >= MAX_WRONG_ATTEMPTS:
                self._pairs.delete(digest)
                raise PairingRefused(
                    "pin_invalidated", "too many wrong PINs: this request is invalidated"
                )
            raise PairingRefused(
                "wrong_pin",
                "that is not this request's PIN",
                remaining=MAX_WRONG_ATTEMPTS - attempts,
            )
        if request.approved_name is None:
            return Polled(status="pending")
        name, token = self._issue(request.approved_name)
        self._pairs.delete(digest)
        return Polled(status="approved", name=name, token=token)

    def pending(self) -> list[Pending]:
        """The requests waiting for approval."""
        self._now()
        return [
            Pending(pin=r.pin, name=r.name, expires=r.expires)
            for r in self._pairs.all()
            if r.approved_name is None
        ]

    def lookup(self, pin: str) -> Pending:
        """The waiting request with ``pin``, for the approver to see its suggested name."""
        for request in self.pending():
            if request.pin == pin:
                return request
        raise PairingRefused("unknown_pin", "no device is waiting with that PIN")

    def approve(self, pin: str, name: str | None) -> str:
        """Approves the request with ``pin`` under ``name`` (its suggested name if ``None``) and
        answers the name the device will hold: ``name`` with a ``-2``, ``-3`` … suffix if another
        device already has it."""
        waiting = self.lookup(pin)
        final = self._free_name(client_name(name) if name is not None else waiting.name)
        if not self._pairs.approve(pin, final):
            raise PairingRefused("unknown_pin", "no device is waiting with that PIN")
        return final

    def _issue(self, wanted: str) -> tuple[str, str]:
        """A token for ``wanted``, or for the next free name if a client took it meanwhile."""
        name = wanted
        for suffix in range(2, 1000):
            try:
                return name, self._tokens.add(name)
            except ClientAlreadyHasToken:
                name = self._suffixed(wanted, suffix)
        raise PairingRefused("name_taken", f"no free name was found for {wanted}")

    def _free_name(self, wanted: str) -> str:
        taken = {c.client.lower() for c in self._tokens.issued()}
        taken |= {r.approved_name.lower() for r in self._pairs.all() if r.approved_name}
        name, suffix = wanted, 1
        while name.lower() in taken:
            suffix += 1
            name = self._suffixed(wanted, suffix)
        return name

    @staticmethod
    def _suffixed(name: str, number: int) -> str:
        return f"{name}-{number}"

    def _now(self) -> datetime:
        now = self._clock()
        self._pairs.purge_expired(now)
        return now
