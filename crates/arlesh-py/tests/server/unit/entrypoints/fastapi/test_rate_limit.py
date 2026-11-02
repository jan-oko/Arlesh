"""The per-address limit on the route open without a token."""

from __future__ import annotations

import pytest
from arlesh.server.entrypoints.fastapi.exceptions import RateLimited
from arlesh.server.entrypoints.fastapi.rate_limit import RateLimiter


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_hits_past_the_limit_are_refused_with_the_wait() -> None:
    clock = Clock()
    limiter = RateLimiter(2, 60.0, clock)
    limiter.hit("a")
    clock.now += 10
    limiter.hit("a")

    with pytest.raises(RateLimited) as refused:
        limiter.hit("a")

    assert refused.value.retry_after == 50


def test_the_window_slides() -> None:
    clock = Clock()
    limiter = RateLimiter(1, 60.0, clock)
    limiter.hit("a")
    clock.now += 60

    limiter.hit("a")


def test_each_address_has_its_own_allowance() -> None:
    limiter = RateLimiter(1, 60.0, Clock())
    limiter.hit("a")

    limiter.hit("b")


def test_idle_addresses_are_forgotten() -> None:
    clock = Clock()
    limiter = RateLimiter(1, 60.0, clock)
    for number in range(1025):
        limiter.hit(str(number))
    clock.now += 61

    limiter.hit("new")

    assert len(limiter._hits) <= 2
