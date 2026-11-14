"""The change stream's text, over a fake database."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

import arlesh
import pytest
from arlesh.backends import BoardHead
from arlesh.server.entrypoints.fastapi import shutdown
from arlesh.server.entrypoints.fastapi.routers.events import board_changes


def _head(seq: int) -> BoardHead:
    return BoardHead(epoch="run", seq=seq, revision=seq, hash=7, sums={"tasks": 7})


def _database(events: list[list[tuple[int, str]]], head_seq: int = 4) -> Any:
    """A database whose publisher has made publication ``head_seq`` and answers ``events`` one
    call at a time, then nothing."""
    database = AsyncMock(spec=arlesh.Database)
    database.board_head = lambda: _head(head_seq)
    answers = iter(events)

    async def after(_after: int, _wait: float) -> list[tuple[int, str]]:
        await asyncio.sleep(0)
        answer: list[tuple[int, str]] = next(answers, [])
        return answer

    database.board_events_after = after
    return database


async def _take(stream: Any, count: int) -> list[str]:
    chunks: list[str] = []
    async for chunk in stream:
        chunks.append(chunk)
        if len(chunks) == count:
            break
    return chunks


async def test_a_quiet_stream_sends_the_head_in_place_of_a_keepalive_comment() -> None:
    stream = board_changes(_database([]), epoch="run", last_event_id=None, keepalive=1.0)

    chunks = await _take(stream, 4)

    assert chunks[0] == ": connected\n\n"
    assert chunks[1].startswith("event: board-head\ndata: ")
    assert chunks[2].startswith("event: board-head\ndata: ")
    assert not any(chunk.startswith(": keepalive") for chunk in chunks)


async def test_each_publication_is_an_event_with_its_epoch_and_sequence_as_its_id() -> None:
    database = _database([[(5, '{"seq":5}'), (6, '{"seq":6}')]])
    stream = board_changes(database, epoch="run", last_event_id=None, keepalive=60.0)

    chunks = await _take(stream, 4)

    assert chunks[2] == 'id: run:5\nevent: board-changed\ndata: {"seq":5}\n\n'
    assert chunks[3] == 'id: run:6\nevent: board-changed\ndata: {"seq":6}\n\n'


async def test_a_reconnect_of_this_run_is_sent_what_it_missed_before_the_head() -> None:
    database = _database([[(3, '{"seq":3}')], [(4, '{"seq":4}')]])
    asked: list[int] = []
    inner = database.board_events_after

    async def recording(after: int, wait: float) -> list[tuple[int, str]]:
        asked.append(after)
        answer: list[tuple[int, str]] = await inner(after, wait)
        return answer

    database.board_events_after = recording
    stream = board_changes(database, epoch="run", last_event_id="run:2", keepalive=60.0)

    chunks = await _take(stream, 4)

    assert chunks[0].startswith("id: run:3\nevent: board-changed")
    assert chunks[1] == ": connected\n\n"
    assert chunks[2].startswith("event: board-head")
    assert chunks[3].startswith("id: run:4\n")
    assert asked[:2] == [2, 3]


async def test_an_id_of_another_run_asks_from_the_start_so_it_is_told_to_reload() -> None:
    database = _database([[(4, '{"seq":4,"reload":true}')]])
    asked: list[int] = []
    inner = database.board_events_after

    async def recording(after: int, wait: float) -> list[tuple[int, str]]:
        asked.append(after)
        answer: list[tuple[int, str]] = await inner(after, wait)
        return answer

    database.board_events_after = recording
    stream = board_changes(database, epoch="run", last_event_id="other:9", keepalive=60.0)

    chunks = await _take(stream, 1)

    assert asked == [0]
    assert chunks[0] == 'id: run:4\nevent: board-changed\ndata: {"seq":4,"reload":true}\n\n'


async def test_a_quiet_stream_ends_when_the_server_goes_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(shutdown, "_going_down", True)
    stream = board_changes(_database([]), epoch="run", last_event_id=None, keepalive=60.0)

    chunks = [chunk async for chunk in stream]

    assert len(chunks) == 2
    assert chunks[0] == ": connected\n\n"
