"""The push store port: which devices are registered for push, and what each was told."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class Channel(StrEnum):
    """The kind of event a notification tells of. Each is one Android notification channel of the
    same id, which the user switches on or off in the system settings."""

    agent_question = "agent_question"
    task_overdue = "task_overdue"
    task_generated = "task_generated"
    capacity_locked = "capacity_locked"
    capacity_cleared = "capacity_cleared"


class PushDevice(BaseModel):
    """A device registered for push."""

    client: str
    """The device's client name: the one its bearer token carries."""
    fcm_token: str


class PushEvent(BaseModel):
    """One notification owed to a device: a fact that became true on the board."""

    key: str
    """The fact's key, also the notification's tag on the phone."""
    value: str
    """What is recorded under the key once the event is sent."""
    channel: Channel
    task: str | None = None
    """The Task it is about, keyed as the board keys it (``task-12``): what a tap opens."""
    title: str | None = None
    """The Task's title."""

    def data(self) -> dict[str, str]:
        """The event as an FCM data message's fields, which are all strings."""
        data = {"channel": self.channel.value, "tag": self.key}
        if self.task is not None:
            data["task"] = self.task
        if self.title is not None:
            data["title"] = self.title
        return data


class DevicePlan(BaseModel):
    """A device, and what it is owed."""

    device: PushDevice
    events: list[PushEvent]


class SentEntry(BaseModel):
    """A fact recorded as notified."""

    key: str
    value: str = ""


class PushStore(ABC):
    """Registered devices, and the record of what each was told. Calls block: run them off the
    event loop."""

    @abstractmethod
    def register(self, client: str, fcm_token: str, *, now: datetime | None = None) -> bool:
        """Registers ``client``'s FCM token, replacing its last, and answers whether the device is
        new. A new device is taken to have been told everything already true on the board."""

    @abstractmethod
    def unregister(self, client: str) -> bool:
        """Removes ``client``'s registration and record. Answers whether it had one."""

    @abstractmethod
    def devices(self) -> list[PushDevice]:
        """Every registered device."""

    @abstractmethod
    def plan(self, *, now: datetime | None = None) -> list[DevicePlan]:
        """What each device is owed at ``now`` (the local clock by default), from the board
        derived by the core's rules. A device owed nothing is left out."""

    @abstractmethod
    def record(self, client: str, entries: list[SentEntry], *, now: datetime | None = None) -> None:
        """Records that ``client`` was told ``entries``."""
