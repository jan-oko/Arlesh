"""The board: a reader opened at startup, one write-open per client, and each client's MCP
endpoint — over a fake of the ``arlesh`` package's Database port."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import arlesh
import pytest
from arlesh.server.business_logic.board import SERVER_CLIENT, Board, BoardNotOpen
from loguru import logger


@pytest.fixture
def logged() -> Iterator[list[str]]:
    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(str(message)), level="DEBUG")
    yield lines
    logger.remove(sink)


async def test_startup_takes_the_hold_and_write_opens_as_the_server(
    fake_opener: Any, fake_holds: Any
) -> None:
    board = Board(fake_opener, fake_holds)

    await board.open()

    assert fake_opener.calls == [SERVER_CLIENT]
    assert board.reader is fake_opener.opened[0]
    assert len(fake_holds.taken) == 1


async def test_a_held_database_refuses_startup_and_opens_nothing(
    fake_opener: Any, fake_holds: Any
) -> None:
    fake_holds.refusal = arlesh.NotPermitted("held", {"reason": "held"})

    with pytest.raises(arlesh.NotPermitted):
        await Board(fake_opener, fake_holds).open()

    assert fake_opener.calls == []


async def test_a_refused_startup_open_releases_the_hold(refusing: Any, fake_holds: Any) -> None:
    board = Board(refusing(arlesh.InvalidRequest("ahead", {"reason": "schema_ahead"})), fake_holds)

    with pytest.raises(arlesh.InvalidRequest):
        await board.open()

    fake_holds.taken[0].release.assert_called_once()


async def test_forced_it_says_plainly_there_may_be_two_writers(
    fake_opener: Any, fake_holds: Any, logged: list[str]
) -> None:
    await Board(fake_opener, fake_holds, force=True).open()

    assert fake_opener.calls == [SERVER_CLIENT]
    assert fake_holds.taken == []
    assert any("two writers" in line for line in logged)


def test_a_reader_before_startup_is_an_error(fake_opener: Any, fake_holds: Any) -> None:
    with pytest.raises(BoardNotOpen):
        _ = Board(fake_opener, fake_holds).reader


async def test_each_client_is_opened_once_and_kept(fake_opener: Any, fake_holds: Any) -> None:
    board = Board(fake_opener, fake_holds, force=True)

    first = await board.writer("phone")
    again = await board.writer("phone")
    other = await board.writer("laptop")

    assert first is again
    assert other is not first
    assert fake_opener.calls == ["phone", "laptop"]


async def test_a_clients_mcp_endpoint_is_served_on_loopback_from_its_own_write_open(
    fake_opener: Any, fake_holds: Any
) -> None:
    board = Board(fake_opener, fake_holds)

    url = await board.mcp_endpoint("phone")
    again = await board.mcp_endpoint("phone")
    laptop = await board.mcp_endpoint("laptop")

    phone_db: Any = await board.writer("phone")
    assert url == again == "http://127.0.0.1:5000/mcp"
    assert laptop == "http://127.0.0.1:5001/mcp"
    phone_db.serve_mcp.assert_awaited_once_with(host="127.0.0.1", port=0)


async def test_close_closes_every_open_database(fake_opener: Any, fake_holds: Any) -> None:
    board = Board(fake_opener, fake_holds)
    await board.open()
    await board.writer("phone")

    await board.close()

    for database in fake_opener.opened:
        database.close.assert_awaited_once()
    fake_holds.taken[0].release.assert_called_once()
    with pytest.raises(BoardNotOpen):
        _ = board.reader
