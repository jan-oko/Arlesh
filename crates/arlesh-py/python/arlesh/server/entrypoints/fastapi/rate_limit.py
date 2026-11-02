"""A sliding-window limit per key, for the one route open without a token."""

from __future__ import annotations

import math
import time
from collections import defaultdict, deque
from collections.abc import Callable

from arlesh.server.entrypoints.fastapi.exceptions import RateLimited


class RateLimiter:
    """Admits at most ``limit`` hits per key in any ``window`` seconds. In memory, so a restart
    forgets it, which is fine for a guard against a flood rather than a quota."""

    def __init__(
        self, limit: int, window: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._limit = limit
        self._window = window
        self._clock = clock
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> None:
        """Counts a hit by ``key``. Raises :class:`RateLimited` if that is one too many."""
        now = self._clock()
        hits = self._hits[key]
        while hits and now - hits[0] >= self._window:
            hits.popleft()
        if len(hits) >= self._limit:
            raise RateLimited(math.ceil(self._window - (now - hits[0])))
        hits.append(now)
        if len(self._hits) > 1024:
            self._forget_idle(now)

    def _forget_idle(self, now: float) -> None:
        for key in [k for k, h in self._hits.items() if not h or now - h[-1] >= self._window]:
            del self._hits[key]
