"""When the board can change with no write: the moments the notifier looks again.

A Task becomes Overdue, a Habit occurrence appears and a wait's check falls due as time passes,
with nothing written. The board is re-derived at the boundaries that matter, which are where a
scope begins or ends: each part of day, and the 02:00 the days turn over at. Those moments come
from the core's scope rules, not from a copy of them here.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from arlesh import rules
from arlesh.models import PartOfDay, ScopeKey, ScopeKind

PARTS = (
    PartOfDay.premorning,
    PartOfDay.morning,
    PartOfDay.noon,
    PartOfDay.afternoon,
    PartOfDay.evening,
    PartOfDay.night,
)
"""The six bands a day is cut into, 02:00 to 02:00."""


def next_boundary(now: datetime) -> datetime:
    """The first moment after ``now`` at which a part of day or a day begins or ends."""
    found: list[datetime] = []
    for offset in (-1, 0, 1):
        day = now.date() + timedelta(days=offset)
        for key in _scope_keys(day):
            window = rules.resolve_scope(key, now)
            found.extend((datetime.fromisoformat(window.start), datetime.fromisoformat(window.end)))
    return min(moment for moment in found if moment > now)


def _scope_keys(day: date) -> list[ScopeKey]:
    keys = [rules.part_scope(day, part).id for part in PARTS]
    keys.append(rules.scope_containing(ScopeKind.day, day).id)
    return keys


def seconds_until_next_look(now: datetime, tick: float) -> float:
    """How long to wait before the next look: until the next boundary, but never longer than
    ``tick``, the coarse beat that catches anything a boundary does not, and never in a hot loop
    (a second at least, unless ``tick`` is shorter)."""
    until = (next_boundary(now) - now).total_seconds()
    return max(min(1.0, tick), min(tick, until + 1.0))
