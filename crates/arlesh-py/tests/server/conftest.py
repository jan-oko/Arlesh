"""Fixtures for the server's tests: a server over a fresh temporary database, a token to reach
it with, and the few nodes most tests hang things on."""

from __future__ import annotations

import asyncio
import fcntl
import shutil
import warnings
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path
from typing import Any

import arlesh
import pytest
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.business_logic.board import Board
from arlesh.server.ports.data_access.sqlite_database_file import SqliteDatabaseFile
from arlesh.server.ports.tokens.file_token_store import FileTokenStore

with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    from fastapi.testclient import TestClient

ROOT_ASPECT = 1
"""The fixed Aspect a fresh database is seeded with first."""

Create = Callable[[str, dict[str, Any]], dict[str, Any]]
NewTask = Callable[..., int]
Start = Callable[..., ArleshServer]


@pytest.fixture(scope="session")
def migrated(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A freshly created and migrated database, made once: migrating is most of a test's time."""
    path = tmp_path_factory.mktemp("template") / "arlesh.db"

    async def create() -> None:
        database = await arlesh.open(path, client="pytest")
        await database.close()

    asyncio.run(create())
    return path


@pytest.fixture
def server_db(tmp_path: Path, migrated: Path) -> Path:
    """The test's own copy of a fresh, migrated database."""
    path = tmp_path / "arlesh.db"
    for suffix in ("", "-wal", "-shm"):
        source = migrated.with_name(migrated.name + suffix)
        if source.exists():
            shutil.copyfile(source, path.with_name(path.name + suffix))
    return path


@pytest.fixture
def tokens(server_db: Path) -> FileTokenStore:
    """The token store beside the test's database."""
    return FileTokenStore.beside(server_db)


@pytest.fixture
def start(server_db: Path, tokens: FileTokenStore) -> Start:
    """Builds the server over the test's database, as ``arlesh-server`` does."""

    def build(*, force: bool = False, path: Path | None = None) -> ArleshServer:
        database = path if path is not None else server_db
        return ArleshServer(
            board=Board(SqliteDatabaseFile(database), force=force),
            tokens=FileTokenStore.beside(database) if path is not None else tokens,
            version="test",
        )

    return build


@pytest.fixture
def server(start: Start, tokens: FileTokenStore) -> Iterator[TestClient]:
    """The server, started, and reached with the token of client ``tests``."""
    headers = {"Authorization": f"Bearer {tokens.add('tests')}"}
    with TestClient(start(), headers=headers) as client:
        yield client


@pytest.fixture
def create(server: TestClient) -> Create:
    """Creates a node through a route and answers it, failing the test if it was refused."""

    def post(path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = server.post(path, json=body)
        assert response.status_code == 201, response.text
        created: dict[str, Any] = response.json()
        return created

    return post


@pytest.fixture
def domain(create: Create) -> int:
    """A Domain under the root Aspect, to hang nodes on."""
    identifier: int = create(
        "/domains", {"title": "Home", "subtype": "domain", "parent_id": ROOT_ASPECT}
    )["id"]
    return identifier


@pytest.fixture
def new_task(create: Create) -> NewTask:
    """Creates a Task under a Domain and answers its id."""

    def make(parent: int, title: str = "Write it", **fields: Any) -> int:
        body = {"title": title, "parent_type": "domain", "parent_id": parent, **fields}
        identifier: int = create("/tasks", body)["id"]
        return identifier

    return make


@pytest.fixture
def app_hold(server_db: Path) -> Callable[[], AbstractContextManager[None]]:
    """The desktop app's hold on the test's database, taken as the app takes it: an exclusive
    lock on ``<db>.lock``."""

    @contextmanager
    def hold() -> Iterator[None]:
        with server_db.with_name(server_db.name + ".lock").open("wb") as file:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                yield
            finally:
                fcntl.flock(file, fcntl.LOCK_UN)

    return hold


def day(date: str) -> dict[str, Any]:
    """A one-Day Time Scope."""
    key = {"kind": "day", "date": date}
    return {"start_id": key, "end_id": key}


@pytest.fixture
def one_day() -> Callable[[str], dict[str, Any]]:
    """A one-Day Time Scope, by its date."""
    return day
