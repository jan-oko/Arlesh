"""A server given a time zone derives its board in that zone, not the host's: the instant the board
is derived at (which "today", Overdue and the hash are judged on) is the zone's wall clock."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import arlesh
import httpx
import pytest
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore

from tests.server.integration.live_stream import follow

Start = Callable[..., ArleshServer]


@pytest.fixture
def host_zone() -> Iterator[None]:
    yield
    arlesh.set_time_zone(None)


def _zone_on_another_day_than_utc() -> str:
    """A zone whose calendar date is not the UTC date now: UTC+14 is ahead of it for the last
    fourteen hours of the UTC day, UTC-12 behind it for the first twelve."""
    utc_day = datetime.now(UTC).date()
    for name in ("Pacific/Kiritimati", "Etc/GMT+12"):
        if datetime.now(ZoneInfo(name)).date() != utc_day:
            return name
    raise AssertionError("no zone is on another day than UTC")


def test_the_board_is_derived_at_the_zones_wall_clock(
    live: str, tokens: DatabaseTokenStore, host_zone: None
) -> None:
    # `live` has started its server already: tell the zone first, then let the next derive show it.
    zone = _zone_on_another_day_than_utc()
    arlesh.set_time_zone(zone)
    auth = {"Authorization": f"Bearer {tokens.add('desktop')}"}
    stream = follow(live, auth["Authorization"].removeprefix("Bearer "))
    assert stream.connected.wait(20)
    stream.heads.get(timeout=20)
    written = httpx.post(
        f"{live}/tasks",
        json={"title": "Nudge a publication", "parent_type": "domain", "parent_id": 1},
        headers=auth,
    )
    assert written.status_code == 201, written.text

    event = stream.next_change()
    derived = datetime.fromisoformat(event["now"])

    assert derived.date() == datetime.now(ZoneInfo(zone)).date()
    assert derived.date() != datetime.now(UTC).date()
