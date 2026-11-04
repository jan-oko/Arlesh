"""Fixtures: a fresh, migrated database per test, opened for writing as client ``pytest``."""

from __future__ import annotations

import signal
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from types import FrameType

import arlesh
import pytest
from arlesh.models import CreateDomainRequest, DomainSubtype

TEST_TIMEOUT_SECONDS = 120


@pytest.fixture(autouse=True)
def no_test_waits_forever() -> Iterator[None]:
    """Fails a test that runs past ``TEST_TIMEOUT_SECONDS``, so a stuck server or stream is a red
    test and not a CI job that sits until it is cancelled."""

    def give_up(signum: int, frame: FrameType | None) -> None:
        pytest.fail(f"the test ran for more than {TEST_TIMEOUT_SECONDS}s", pytrace=False)

    previous = signal.signal(signal.SIGALRM, give_up)
    signal.alarm(TEST_TIMEOUT_SECONDS)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


@pytest.fixture
def database_path(tmp_path: Path) -> Path:
    """Where the test's database lives. Nothing is there until something opens it to write."""
    return tmp_path / "arlesh.db"


@pytest.fixture
async def db(database_path: Path) -> AsyncIterator[arlesh.Database]:
    """The test's database, migrated and open for writing."""
    async with await arlesh.open(database_path, client="pytest") as database:
        yield database


@pytest.fixture
async def domain_id(db: arlesh.Database) -> int:
    """A Domain under the first seeded Aspect, for nodes to hang under."""
    aspects = await db.list_domains(DomainSubtype.aspect)
    domain = await db.create_domain(
        CreateDomainRequest(title="Tests", subtype=DomainSubtype.domain, parent_id=aspects[0].id)
    )
    return domain.id
