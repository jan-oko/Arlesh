"""``Arlesh(backend=HttpBackend(…))`` against a real ``arlesh-server`` on a socket.

The server's other tests use an in-process ASGI client, which the Rust HTTP client cannot reach;
these run the server under uvicorn (the ``live`` fixture) and drive the app's own client through
the Python façade.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncGenerator, AsyncIterator

import arlesh
import pytest
from arlesh.models import (
    CreateDomainRequest,
    CreateTaskRequest,
    DomainSubtype,
    UpdateTaskRequest,
)
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore

ROOT_ASPECT = 1


@pytest.fixture
async def board(live: str, tokens: DatabaseTokenStore) -> AsyncIterator[arlesh.Arlesh]:
    """A device of the server, over HTTP."""
    backend = arlesh.HttpBackend(live, token=tokens.add("python"))
    async with arlesh.Arlesh(backend=backend) as opened:
        yield opened


async def _domain(board: arlesh.Arlesh) -> int:
    domain = await board.create_domain(
        CreateDomainRequest(title="Home", subtype=DomainSubtype.domain, parent_id=ROOT_ASPECT)
    )
    return domain.id


async def test_a_task_is_created_updated_and_read_over_http(board: arlesh.Arlesh) -> None:
    assert board.client is None
    parent = await _domain(board)

    task = await board.create_task(
        CreateTaskRequest(title="Write it", parent_type="domain", parent_id=parent)
    )
    updated = await board.update_task(task.id, UpdateTaskRequest(title="Wrote it"))
    assert isinstance(task.id, int)
    read = await board.get_task(task.id)

    assert updated.title == "Wrote it"
    assert read.task.title == "Wrote it"
    loaded = await board.board()
    assert [t.title for t in loaded.tasks] == ["Wrote it"]


async def test_the_board_is_stamped_with_the_servers_revision(board: arlesh.Arlesh) -> None:
    assert board.board_revision is None
    await _domain(board)
    await board.board()

    stamp = board.board_revision
    assert stamp is not None
    assert stamp.revision >= 1
    status = board.server_status
    assert status is not None
    assert status.reachable
    assert status.read_only is None
    assert status.last_sync is not None


async def test_a_refusal_is_the_same_class_as_over_sqlite(board: arlesh.Arlesh) -> None:
    with pytest.raises(arlesh.NotFound):
        await board.get_task(424242)


async def test_operations_only_sqlite_has_are_refused_in_client_mode(board: arlesh.Arlesh) -> None:
    for refused in (board.serve_mcp, board.stop_mcp, board.reset_undo):
        with pytest.raises(arlesh.NotPermitted) as refusal:
            await refused()
        assert refusal.value.details == {"reason": "not_in_client_mode"}


async def test_another_clients_write_reaches_changes(
    board: arlesh.Arlesh, live: str, tokens: DatabaseTokenStore
) -> None:
    other = arlesh.Arlesh(backend=arlesh.HttpBackend(live, token=tokens.add("second")))
    async with other:
        changes = board.changes()
        heard = asyncio.ensure_future(_until_revision(changes, 1))
        await asyncio.sleep(0.3)
        await _domain(other)
        change = await asyncio.wait_for(heard, 20)
        assert change.revision >= 1
        await changes.aclose()


async def _until_revision(
    changes: AsyncGenerator[arlesh.BoardRevision | None, None], revision: int
) -> arlesh.BoardRevision:
    async for change in changes:
        if change is not None and change.revision >= revision:
            return change
    raise AssertionError("the change stream ended")


async def test_the_stream_is_open_only_while_someone_listens(board: arlesh.Arlesh) -> None:
    native = board._native
    assert not native.following()  # type: ignore[union-attr]
    changes = board.changes()
    heard = asyncio.ensure_future(anext(changes))
    await asyncio.sleep(0.3)
    assert native.following()  # type: ignore[union-attr]
    heard.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await heard
    await changes.aclose()
    assert not native.following()  # type: ignore[union-attr]


async def test_a_large_board_comes_back_whole(board: arlesh.Arlesh) -> None:
    parent = await _domain(board)
    for number in range(40):
        await board.create_task(
            CreateTaskRequest(
                title=f"Task {number} " + "x" * 200, parent_type="domain", parent_id=parent
            )
        )
    loaded = await board.board()
    assert len(loaded.tasks) == 40


async def test_a_pairing_gives_a_token_that_opens_a_backend(
    live: str, tokens: DatabaseTokenStore
) -> None:
    started = await arlesh.pairing.start(live, "pytest-device")
    assert len(started.pin) == 6
