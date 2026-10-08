"""Holding a database: the lock the desktop app takes, for a writer meaning to be the only one."""

from __future__ import annotations

from pathlib import Path

import arlesh
import pytest


def test_a_held_database_cannot_be_held_again(database_path: Path) -> None:
    with arlesh.hold(database_path) as hold:
        assert hold.held
        with pytest.raises(arlesh.NotPermitted) as refusal:
            arlesh.hold(database_path)

    assert refusal.value.details["reason"] == "held"
    assert not hold.held


def test_a_released_hold_can_be_taken_again_and_released_twice(database_path: Path) -> None:
    hold = arlesh.hold(database_path)
    hold.release()
    hold.release()

    arlesh.hold(database_path).release()


async def test_a_write_open_is_refused_while_held_unless_forced(database_path: Path) -> None:
    with arlesh.hold(database_path):
        with pytest.raises(arlesh.NotPermitted) as refusal:
            await arlesh.open(database_path, client="script")
        forced = await arlesh.open(database_path, client="script", force=True)
        await forced.close()

    assert refusal.value.details["reason"] == "held_by_app"


def test_the_database_port_is_what_open_returns() -> None:
    assert issubclass(arlesh.SqliteDatabase, arlesh.Database)
