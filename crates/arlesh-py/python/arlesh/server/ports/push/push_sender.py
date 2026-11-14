"""The push sender port: delivering one notification to one device."""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import StrEnum

from arlesh.server.ports.push.push_store import PushEvent


class Delivery(StrEnum):
    """What the push service said of one message."""

    accepted = "accepted"
    """Taken for delivery: record it as sent."""
    unregistered = "unregistered"
    """The device's token is no longer valid: drop the registration."""
    failed = "failed"
    """Not taken, for now (the service, the network or our credentials): try again at the next
    look."""


class PushSender(ABC):
    """Sends a notification to a device by its push token."""

    @property
    @abstractmethod
    def project_id(self) -> str:
        """The push project it sends from."""

    @abstractmethod
    async def send(self, fcm_token: str, event: PushEvent) -> Delivery:
        """Sends ``event`` to the device holding ``fcm_token``. Never raises for a delivery that
        did not happen: it answers :attr:`Delivery.failed`."""

    async def aclose(self) -> None:  # noqa: B027 - a sender may hold nothing to close
        """Releases whatever the sender holds."""
