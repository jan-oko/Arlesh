"""A service over a fresh temporary database for each test, and the few nodes most tests need."""

from __future__ import annotations

import asyncio
import fcntl
import shutil
import warnings
from collections.abc import Iterator
from pathlib import Path
from typing import Any, BinaryIO

import arlesh
import pytest

with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    from fastapi.testclient import TestClient

from arlesh_api import Settings, create_app

WRITER = {"X-Arlesh-Client": "tests"}
"""The header every write in the tests names its client with."""

ROOT_ASPECT = 1
"""The fixed Aspect a fresh database is seeded with first."""


def day(date: str) -> dict[str, Any]:
    """A one-Day Time Scope."""
    key = {"kind": "day", "date": date}
    return {"start_id": key, "end_id": key}


@pytest.fixture(scope="session")
def migrated(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A freshly created and migrated database, made once: migrating is most of a test's time."""
    path = tmp_path_factory.mktemp("template") / "arlesh.db"

    async def create() -> None:
        database = await arlesh.open(path, client="tests")
        await database.close()

    asyncio.run(create())
    return path


@pytest.fixture
def db_path(tmp_path: Path, migrated: Path) -> Path:
    """The test's own copy of a fresh database."""
    path = tmp_path / "arlesh.db"
    for suffix in ("", "-wal", "-shm"):
        source = migrated.with_name(migrated.name + suffix)
        if source.exists():
            shutil.copyfile(source, path.with_name(path.name + suffix))
    return path


@pytest.fixture
def client(db_path: Path) -> Iterator[TestClient]:
    """The service, started over the test's database."""
    with TestClient(create_app(Settings(db_path=db_path))) as running:
        yield running


@pytest.fixture
def domain(client: TestClient) -> int:
    """A Domain under the root Aspect, to hang nodes on."""
    response = client.post(
        "/domains",
        json={"title": "Home", "subtype": "domain", "parent_id": ROOT_ASPECT},
        headers=WRITER,
    )
    assert response.status_code == 201, response.text
    identifier: int = response.json()["id"]
    return identifier


def create(client: TestClient, path: str, body: dict[str, Any]) -> dict[str, Any]:
    """Creates a node through ``path`` and answers it, failing the test if it was refused."""
    response = client.post(path, json=body, headers=WRITER)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def task(client: TestClient, parent: int, title: str = "Write it", **fields: Any) -> int:
    """A Task under the Domain ``parent``; answers its id."""
    body = {"title": title, "parent_type": "domain", "parent_id": parent, **fields}
    identifier: int = create(client, "/tasks", body)["id"]
    return identifier


class AppHold:
    """The desktop app's hold on a database, as the app takes it: an exclusive lock on
    ``<db>.lock``."""

    def __init__(self, db_path: Path) -> None:
        self._path = db_path.with_name(db_path.name + ".lock")
        self._file: BinaryIO | None = None

    def __enter__(self) -> AppHold:
        self._file = self._path.open("wb")
        fcntl.flock(self._file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return self

    def __exit__(self, *_exc: object) -> None:
        if self._file is not None:
            fcntl.flock(self._file, fcntl.LOCK_UN)
            self._file.close()
