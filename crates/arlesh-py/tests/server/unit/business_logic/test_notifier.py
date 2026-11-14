"""The notifier's loop: it looks at a write, at a boundary and on the tick, and a failed look does
not stop it. Over an in-memory store and board, so time and writes are the test's."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from arlesh.server.business_logic.notifier import Notifier
from arlesh.server.ports.push.push_sender import Delivery, PushSender
from arlesh.server.ports.push.push_store import (
    Channel,
    DevicePlan,
    PushDevice,
    PushEvent,
    PushStore,
    SentEntry,
)


class Clock:
    def __init__(self, at: str) -> None:
        self.at = datetime.fromisoformat(at)

    def __call__(self) -> datetime:
        return self.at


class FakeStore(PushStore):
    """One device, owed an event from ``due`` on until it is recorded."""

    def __init__(self, due: datetime) -> None:
        self.due = due
        self.told: set[str] = set()
        self.registered = True
        self.failing = False
        self.looks = 0

    def register(self, client: str, fcm_token: str, *, now: datetime | None = None) -> bool:
        return True

    def unregister(self, client: str) -> bool:
        self.registered = False
        return True

    def devices(self) -> list[PushDevice]:
        return [PushDevice(client="phone", fcm_token="t")] if self.registered else []

    def plan(self, *, now: datetime | None = None) -> list[DevicePlan]:
        self.looks += 1
        if self.failing:
            raise RuntimeError("the database is away")
        assert now is not None
        if not self.registered or now < self.due or "overdue:1" in self.told:
            return []
        event = PushEvent(key="overdue:1", value="", channel=Channel.task_overdue)
        return [DevicePlan(device=self.devices()[0], events=[event])]

    def record(self, client: str, entries: list[SentEntry], *, now: datetime | None = None) -> None:
        self.told.update(entry.key for entry in entries)


class FakeSender(PushSender):
    def __init__(self) -> None:
        self.sent: list[PushEvent] = []
        self.delivery = Delivery.accepted

    @property
    def project_id(self) -> str:
        return "p"

    async def send(self, fcm_token: str, event: PushEvent) -> Delivery:
        self.sent.append(event)
        return self.delivery


class FakeReader:
    """A board whose revision the test moves."""

    def __init__(self) -> None:
        self.revision = 0
        self._moved = asyncio.Condition()

    @property
    def reader(self) -> FakeReader:
        return self

    async def write(self) -> None:
        async with self._moved:
            self.revision += 1
            self._moved.notify_all()

    async def next_change(self, after: int) -> int:
        async with self._moved:
            await self._moved.wait_for(lambda: self.revision > after)
            return self.revision


async def until(condition: Any, seconds: float = 3.0) -> None:
    async with asyncio.timeout(seconds):
        while not condition():
            await asyncio.sleep(0.01)


def notifier(
    board: FakeReader, store: FakeStore, sender: FakeSender | None, clock: Clock, tick: float
) -> Notifier:
    return Notifier(
        board=board,  # type: ignore[arg-type]
        store=store,
        sender=sender,
        clock=clock,
        tick=tick,
        quiet=0.0,
    )


async def test_the_ticker_sends_what_time_alone_made_true_once_a_boundary_is_crossed() -> None:
    clock = Clock("2026-11-04T11:59:00")
    store = FakeStore(due=datetime(2026, 11, 4, 12, 0, 0))
    sender = FakeSender()
    pushes = notifier(FakeReader(), store, sender, clock, tick=0.02)
    pushes.start()
    try:
        await until(lambda: store.looks >= 3)
        assert sender.sent == [], "nothing is owed before the boundary"

        clock.at = datetime(2026, 11, 4, 12, 0, 1)
        await until(lambda: len(sender.sent) == 1)
        looks = store.looks
        await until(lambda: store.looks >= looks + 3)
    finally:
        await pushes.stop()

    assert len(sender.sent) == 1, "recorded, so the later ticks send nothing"


async def test_a_write_is_looked_at_without_waiting_for_the_tick() -> None:
    board = FakeReader()
    store = FakeStore(due=datetime(2026, 1, 1))
    sender = FakeSender()
    store.told.add("overdue:1")
    pushes = notifier(board, store, sender, Clock("2026-11-04T08:00:00"), tick=300.0)
    pushes.start()
    try:
        await until(lambda: store.looks == 1)
        store.told.clear()

        await board.write()
        await until(lambda: len(sender.sent) == 1)
    finally:
        await pushes.stop()

    assert store.looks == 2


async def test_a_look_that_fails_does_not_stop_the_notifier() -> None:
    board = FakeReader()
    store = FakeStore(due=datetime(2026, 1, 1))
    store.failing = True
    sender = FakeSender()
    pushes = notifier(board, store, sender, Clock("2026-11-04T08:00:00"), tick=0.02)
    pushes.start()
    try:
        await until(lambda: store.looks >= 2)
        store.failing = False
        await until(lambda: len(sender.sent) == 1)
    finally:
        await pushes.stop()


async def test_without_a_sender_nothing_is_looked_at() -> None:
    store = FakeStore(due=datetime(2026, 1, 1))
    pushes = notifier(FakeReader(), store, None, Clock("2026-11-04T08:00:00"), tick=0.01)

    pushes.start()
    await asyncio.sleep(0.1)
    await pushes.stop()

    assert store.looks == 0
    assert not pushes.enabled
    assert pushes.project_id is None
