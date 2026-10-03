"""Opening a database: read-only and write-opens, the app's hold, migrations, client names."""

from __future__ import annotations

import fcntl
import sqlite3
from pathlib import Path

import arlesh
import pytest
from arlesh.models import CreateTaskRequest


async def test_a_write_open_creates_and_migrates_a_fresh_database(database_path: Path) -> None:
    async with await arlesh.open(database_path, client="notebook") as db:
        assert db.client == "notebook"
        assert await db.list_domains()
    assert database_path.exists()


async def test_a_read_only_open_reads_and_names_no_client(
    db: arlesh.Database, database_path: Path, domain_id: int
) -> None:
    async with await arlesh.open(database_path) as reader:
        assert reader.client is None
        assert any(domain.id == domain_id for domain in await reader.list_domains())


async def test_a_read_only_open_refuses_every_write(
    db: arlesh.Database, database_path: Path, domain_id: int
) -> None:
    async with await arlesh.open(database_path) as reader:
        with pytest.raises(arlesh.InvalidRequest) as refusal:
            await reader.create_task(
                CreateTaskRequest(title="no", parent_type="domain", parent_id=domain_id)
            )
    assert refusal.value.details == {"reason": "read_only"}


async def test_a_read_only_open_of_a_missing_file_is_not_found(database_path: Path) -> None:
    with pytest.raises(arlesh.NotFound) as refusal:
        await arlesh.open(database_path)
    assert refusal.value.details["reason"] == "missing"
    assert not database_path.exists()


async def test_a_write_open_while_the_app_holds_the_database_is_refused_unless_forced(
    db: arlesh.Database, database_path: Path
) -> None:
    lock = database_path.with_name(database_path.name + ".lock")
    with lock.open("w") as held:
        fcntl.flock(held, fcntl.LOCK_EX)  # what the desktop app holds while it runs
        with pytest.raises(arlesh.NotPermitted) as refusal:
            await arlesh.open(database_path, client="notebook")
        assert refusal.value.details["reason"] == "held_by_app"
        async with await arlesh.open(database_path, client="notebook", force=True) as forced:
            assert forced.client == "notebook"
        async with await arlesh.open(database_path) as reader:
            assert reader.client is None


async def test_a_read_only_open_refuses_a_schema_that_is_behind(
    db: arlesh.Database, database_path: Path
) -> None:
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "DELETE FROM _sqlx_migrations"
            " WHERE version = (SELECT MAX(version) FROM _sqlx_migrations)"
        )
    with pytest.raises(arlesh.InvalidRequest) as refusal:
        await arlesh.open(database_path)
    assert refusal.value.details["reason"] == "schema_behind"


async def test_a_schema_newer_than_the_build_is_refused_both_ways(
    db: arlesh.Database, database_path: Path
) -> None:
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)"
            " VALUES (999999, 'from the future', 1, x'00', 0)"
        )
    for client in (None, "notebook"):
        with pytest.raises(arlesh.InvalidRequest) as refusal:
            await arlesh.open(database_path, client=client)
        assert refusal.value.details == {"reason": "schema_ahead", "migrations": [999999]}


@pytest.mark.parametrize("name", ["", "my script", "a/b", "x" * 65])
async def test_a_client_name_outside_the_alphabet_is_refused(
    database_path: Path, name: str
) -> None:
    with pytest.raises(arlesh.InvalidRequest) as refusal:
        await arlesh.open(database_path, client=name)
    assert refusal.value.details["reason"] == "invalid_client"


async def test_every_write_is_journaled_under_its_client(
    db: arlesh.Database, database_path: Path, domain_id: int
) -> None:
    await db.create_task(CreateTaskRequest(title="mine", parent_type="domain", parent_id=domain_id))
    with sqlite3.connect(database_path) as connection:
        clients = {row[0] for row in connection.execute("SELECT client FROM undo_journal")}
        context = connection.execute("SELECT client FROM undo_context").fetchone()[0]
    assert clients == {"pytest"}
    assert context == "desktop", "the stamp lives only inside the write's own transaction"
