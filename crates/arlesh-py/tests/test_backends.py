"""The backends: what ``Arlesh(backend=…)`` opens, and what it refuses, without a server."""

from __future__ import annotations

import asyncio
import socket
from pathlib import Path

import arlesh
import pytest
from arlesh.models import CreateDomainRequest, DomainSubtype


async def test_an_arlesh_over_a_sqlite_backend_is_what_open_returns(database_path: Path) -> None:
    async with arlesh.Arlesh(backend=arlesh.SqliteBackend(database_path, client="pytest")) as board:
        assert board.client == "pytest"
        assert isinstance(board, arlesh.Database)
        assert board.server_status is None
        assert board.board_revision is None
        assert (await board.board()).tasks == []


async def test_sqlite_database_is_another_name_for_arlesh() -> None:
    assert arlesh.SqliteDatabase is arlesh.Arlesh


async def test_an_arlesh_that_is_not_open_says_so(database_path: Path) -> None:
    board = arlesh.Arlesh(backend=arlesh.SqliteBackend(database_path, client="pytest"))
    with pytest.raises(RuntimeError, match="not open"):
        await board.board()


async def test_a_sqlite_backend_without_a_client_is_read_only(database_path: Path) -> None:
    async with arlesh.Arlesh(backend=arlesh.SqliteBackend(database_path, client="pytest")):
        pass
    async with arlesh.Arlesh(backend=arlesh.SqliteBackend(database_path)) as board:
        assert board.client is None
        with pytest.raises(arlesh.InvalidRequest):
            await board.create_domain(
                CreateDomainRequest(title="x", subtype=DomainSubtype.domain, parent_id=1)
            )


async def test_sqlite_changes_yield_after_a_write(db: arlesh.Database) -> None:
    assert isinstance(db, arlesh.Arlesh)
    changes = db.changes()
    heard = asyncio.ensure_future(anext(changes))
    await asyncio.sleep(0.05)
    aspects = await db.list_domains(DomainSubtype.aspect)
    await db.create_domain(
        CreateDomainRequest(title="Changed", subtype=DomainSubtype.domain, parent_id=aspects[0].id)
    )
    change = await asyncio.wait_for(heard, 10)
    assert change is not None
    assert change.revision >= 1
    await changes.aclose()


def _dead_url() -> str:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    return f"http://127.0.0.1:{port}"


async def test_an_http_backend_to_nothing_is_refused_as_unreachable() -> None:
    backend = arlesh.HttpBackend(_dead_url(), token="nobody")
    with pytest.raises(arlesh.NotPermitted) as refusal:
        await arlesh.Arlesh(backend=backend).open()
    assert refusal.value.details == {"reason": "server_unreachable"}


async def test_pairing_a_server_that_is_not_there_is_refused() -> None:
    with pytest.raises(arlesh.NotPermitted):
        await arlesh.pairing.start(_dead_url(), "notebook")
