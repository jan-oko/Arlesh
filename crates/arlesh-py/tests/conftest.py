"""Fixtures: a fresh, migrated database per test, opened for writing as client ``pytest``."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import arlesh
import pytest
from arlesh.models import CreateDomainRequest, DomainSubtype


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
