"""Phone push: look at the board, send what is new, remember what was sent.

A **look** asks the store what each registered device is owed (the core derives the board and
compares it with what the device was told) and sends it. Looks happen:

* shortly after every committed write, so a question, a lock or a deletion is pushed as it
  happens (writes are told apart from time by the board's revision);
* at the scope boundaries (see :mod:`arlesh.server.business_logic.ticks`) and every ``tick``
  seconds, since a Task becomes Overdue and an occurrence appears with no write at all.

What was sent is recorded per device, only once the push service accepted it, so a restart never
sends again what was sent and a message that failed is tried again at the next look. With no
sender, the server takes registrations and sends nothing.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from datetime import datetime

from loguru import logger

from arlesh.server.business_logic.board import Board, BoardNotOpen
from arlesh.server.business_logic.ticks import seconds_until_next_look
from arlesh.server.ports.push.push_sender import Delivery, PushSender
from arlesh.server.ports.push.push_store import PushStore, SentEntry

TICK_SECONDS = 300.0
"""The coarse beat of looks that no write and no boundary asked for."""

QUIET_SECONDS = 1.0
"""How long the board must be still after a write before it is looked at, so a burst of writes is
one look."""


class Notifier:
    """Pushes the board's news to the registered devices."""

    def __init__(
        self,
        *,
        board: Board,
        store: PushStore,
        sender: PushSender | None,
        clock: Callable[[], datetime] = datetime.now,
        tick: float = TICK_SECONDS,
        quiet: float = QUIET_SECONDS,
    ) -> None:
        self._board = board
        self._store = store
        self._sender = sender
        self._clock = clock
        self._tick = tick
        self._quiet = quiet
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None

    @property
    def project_id(self) -> str | None:
        """The push project the server sends from, or ``None`` when pushes are off."""
        return self._sender.project_id if self._sender is not None else None

    @property
    def enabled(self) -> bool:
        """Whether the server has credentials to send with."""
        return self._sender is not None

    def start(self) -> None:
        """Starts looking, when there is a sender to send with; says plainly when there is not."""
        if self._sender is None:
            logger.info(
                "Push notifications are off: no ARLESH_FCM_CREDENTIALS_FILE. "
                "Devices may register; nothing is sent"
            )
            return
        logger.info("Push notifications are on", project=self._sender.project_id)
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        """Stops looking and releases the sender."""
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._sender is not None:
            await self._sender.aclose()

    async def register(self, client: str, fcm_token: str) -> bool:
        """Registers a device's FCM token, and answers whether the device is new. Serialised with
        the looks, so a look never sees a device half registered."""
        async with self._lock:
            return await asyncio.to_thread(
                self._store.register, client, fcm_token, now=self._clock()
            )

    async def unregister(self, client: str) -> bool:
        """Drops a device's registration, and answers whether it had one."""
        async with self._lock:
            return await asyncio.to_thread(self._store.unregister, client)

    async def look(self) -> int:
        """Sends every device what it is owed, and answers how many messages were accepted."""
        if self._sender is None:
            return 0
        async with self._lock:
            plans = await asyncio.to_thread(self._store.plan, now=self._clock())
            accepted = 0
            for plan in plans:
                told: list[SentEntry] = []
                for event in plan.events:
                    delivery = await self._sender.send(plan.device.fcm_token, event)
                    if delivery is Delivery.accepted:
                        told.append(SentEntry(key=event.key, value=event.value))
                    elif delivery is Delivery.unregistered:
                        logger.info(
                            "Dropping a push token FCM no longer knows", device=plan.device.client
                        )
                        await asyncio.to_thread(self._store.unregister, plan.device.client)
                        told.clear()
                        break
                if told:
                    await asyncio.to_thread(
                        self._store.record, plan.device.client, told, now=self._clock()
                    )
                    accepted += len(told)
            return accepted

    async def _run(self) -> None:
        seen = await self._revision()
        while True:
            try:
                await self.look()
            except Exception:
                logger.exception("A look at the board for pushes failed")
            seen = await self._wait(seen)

    async def _revision(self) -> int:
        while True:
            try:
                return self._board.revision
            except BoardNotOpen:
                await asyncio.sleep(0.1)

    async def _wait(self, seen: int) -> int:
        """Waits for a write or for time, and answers the revision to look at."""
        timeout = seconds_until_next_look(self._clock(), self._tick)
        change = asyncio.ensure_future(self._board.reader.next_change(seen))
        try:
            done, _ = await asyncio.wait({change}, timeout=timeout)
        finally:
            if not change.done():
                change.cancel()
        if not done:
            return seen
        # Let a burst of writes settle: the look is of the board as it stands after them.
        await asyncio.sleep(self._quiet)
        return self._board.revision
