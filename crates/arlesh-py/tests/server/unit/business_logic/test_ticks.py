"""When the notifier looks again with no write to prompt it: the scope boundaries."""

from __future__ import annotations

from datetime import datetime

import pytest
from arlesh.server.business_logic.ticks import next_boundary, seconds_until_next_look


@pytest.mark.parametrize(
    ("now", "boundary"),
    [
        ("2026-11-04T05:59:30", "2026-11-04T06:00:00"),
        ("2026-11-04T06:00:00", "2026-11-04T12:00:00"),
        ("2026-11-04T10:15:00", "2026-11-04T12:00:00"),
        ("2026-11-04T21:59:59", "2026-11-04T22:00:00"),
        ("2026-11-04T23:30:00", "2026-11-05T02:00:00"),
        ("2026-11-05T01:00:00", "2026-11-05T02:00:00"),
    ],
)
def test_the_next_boundary_is_where_a_part_of_day_or_a_day_next_turns(
    now: str, boundary: str
) -> None:
    assert next_boundary(datetime.fromisoformat(now)) == datetime.fromisoformat(boundary)


def test_the_wait_is_until_the_boundary_when_it_is_nearer_than_the_tick() -> None:
    assert seconds_until_next_look(datetime(2026, 11, 4, 5, 59, 30), tick=300.0) == 31.0


def test_the_wait_is_the_tick_when_the_boundary_is_further() -> None:
    assert seconds_until_next_look(datetime(2026, 11, 4, 8, 0, 0), tick=300.0) == 300.0


def test_a_short_tick_is_honoured_and_the_look_follows_a_boundary_by_a_second() -> None:
    assert seconds_until_next_look(datetime(2026, 11, 4, 8, 0, 0), tick=0.05) == 0.05
    assert seconds_until_next_look(
        datetime(2026, 11, 4, 11, 59, 59, 900000), tick=300.0
    ) == pytest.approx(1.1)
