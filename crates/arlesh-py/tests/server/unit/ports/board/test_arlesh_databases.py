"""The board port: a reader opened at startup, and one write-open per client."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import arlesh
import pytest
from arlesh.server.ports.board.arlesh_databases import (
    SERVICE_CLIENT,
    ArleshDatabases,
    DatabasesNotOpen,
)


class FakeDatabase:
    def __init__(self, client: str | None) -> None:
        self.client = client
        self.closed = False

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def opened(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Every ``arlesh.open`` call, answered with a fake database."""
    calls: list[dict[str, Any]] = []

    async def fake_open(path: Path, *, client: str | None = None, force: bool = False) -> Any:
        calls.append({"path": path, "client": client, "force": force})
        return FakeDatabase(client)

    monkeypatch.setattr("arlesh.open", fake_open)
    return calls


async def test_startup_write_opens_as_the_server(opened: list[dict[str, Any]]) -> None:
    databases = ArleshDatabases(Path("a.db"))

    await databases.open()

    assert opened == [{"path": Path("a.db"), "client": SERVICE_CLIENT, "force": False}]
    assert databases.reader.client == SERVICE_CLIENT


async def test_a_reader_before_startup_is_an_error() -> None:
    with pytest.raises(DatabasesNotOpen):
        _ = ArleshDatabases(Path("a.db")).reader


async def test_each_client_is_opened_once_and_kept(opened: list[dict[str, Any]]) -> None:
    databases = ArleshDatabases(Path("a.db"), force=True)

    first = await databases.writer("phone")
    again = await databases.writer("phone")
    other = await databases.writer("laptop")

    assert first is again
    assert other is not first
    assert [call["client"] for call in opened] == ["phone", "laptop"]
    assert all(call["force"] for call in opened)


async def test_close_closes_every_open_database(opened: list[dict[str, Any]]) -> None:
    databases = ArleshDatabases(Path("a.db"))
    await databases.open()
    reader = databases.reader
    writer = await databases.writer("phone")

    await databases.close()

    assert isinstance(reader, FakeDatabase) and reader.closed
    assert isinstance(writer, FakeDatabase) and writer.closed


async def test_a_refused_open_is_raised_as_the_core_raised_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def refuse(*_args: Any, **_kwargs: Any) -> Any:
        raise arlesh.NotPermitted("held", {"reason": "held_by_app"})

    monkeypatch.setattr("arlesh.open", refuse)

    with pytest.raises(arlesh.NotPermitted):
        await ArleshDatabases(Path("a.db")).open()
