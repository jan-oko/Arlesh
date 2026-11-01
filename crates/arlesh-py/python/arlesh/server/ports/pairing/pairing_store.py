"""The pairing store port: the device pairings that have not been claimed or lapsed yet."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

from pydantic import BaseModel


class PairingRequest(BaseModel):
    """A device's request to be paired. The poll's secret id is kept only as its digest."""

    id_sha256: str
    pin: str
    name: str
    """The name the device suggested, already reduced to a client name."""
    approved_name: str | None = None
    """The name the approver settled on; ``None`` until the PIN is approved."""
    attempts: int = 0
    """Wrong PINs presented with this request's id."""
    created: datetime
    expires: datetime


class PairingStore(ABC):
    """Keeps pairing requests from their creation until they are claimed, lapse or are
    invalidated. Rules (lifetimes, limits, names) are the business logic's; this only stores."""

    @abstractmethod
    def create(self, request: PairingRequest) -> bool:
        """Records ``request``. ``False``, writing nothing, when its PIN or id is in use."""

    @abstractmethod
    def all(self) -> list[PairingRequest]:
        """Every request, oldest first."""

    @abstractmethod
    def purge_expired(self, now: datetime) -> int:
        """Deletes the requests that lapsed at or before ``now`` and answers how many."""

    @abstractmethod
    def count_attempt(self, id_sha256: str) -> int | None:
        """Counts one more wrong PIN against a request and answers the count; ``None`` if there
        is no such request."""

    @abstractmethod
    def approve(self, pin: str, name: str) -> bool:
        """Approves the not-yet-approved request with ``pin`` under ``name``; ``False`` if none."""

    @abstractmethod
    def delete(self, id_sha256: str) -> bool:
        """Deletes a request; ``False`` if there was none."""
