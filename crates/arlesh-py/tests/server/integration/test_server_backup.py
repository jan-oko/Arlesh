"""``GET /backup``: a snapshot of the database for the administrator, behind its own secret."""

from __future__ import annotations

import hashlib
import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from arlesh.server.business_logic.board import Board
from arlesh.server.entrypoints.cli.app import holder, opener
from arlesh.server.entrypoints.fastapi.app import ArleshServer, Backup
from arlesh.server.entrypoints.fastapi.routers.backup import MEDIA_TYPE
from arlesh.server.ports.pairing.database_pairing_store import DatabasePairingStore
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore
from fastapi.testclient import TestClient

SECRET = "admin-secret-0123456789"


def _titles(path: Path) -> list[str]:
    with sqlite3.connect(path) as connection:
        rows = connection.execute("SELECT title FROM domains ORDER BY id").fetchall()
    return [title for (title,) in rows]


def _fingerprint(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def backup_server(server_db: Path, tokens: DatabaseTokenStore) -> Iterator[TestClient]:
    """A server with a backup token, reached with no token of its own."""
    database = server_db
    server = ArleshServer(
        board=Board(opener(database), holder(database), force=False),
        tokens=tokens,
        pairs=DatabasePairingStore(database),
        version="test",
        backup=Backup(database, SECRET),
    )
    with TestClient(server) as client:
        yield client


def test_without_a_backup_token_the_route_does_not_exist(server: TestClient) -> None:
    response = server.get("/backup", headers={"Authorization": f"Bearer {SECRET}"})

    assert response.status_code == 404


def test_a_request_without_the_token_is_401(backup_server: TestClient) -> None:
    response = backup_server.get("/backup")

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_a_wrong_token_is_401(backup_server: TestClient) -> None:
    response = backup_server.get("/backup", headers={"Authorization": "Bearer nope"})

    assert response.status_code == 401


def test_a_device_token_does_not_grant_it(
    backup_server: TestClient, tokens: DatabaseTokenStore
) -> None:
    device = tokens.add("phone")

    response = backup_server.get("/backup", headers={"Authorization": f"Bearer {device}"})

    assert response.status_code == 401


def test_the_backup_token_does_not_open_the_board(backup_server: TestClient) -> None:
    response = backup_server.get("/board", headers={"Authorization": f"Bearer {SECRET}"})

    assert response.status_code == 401


def test_the_snapshot_is_a_valid_database_with_the_live_rows(
    backup_server: TestClient, tokens: DatabaseTokenStore, server_db: Path, tmp_path: Path
) -> None:
    created = backup_server.post(
        "/domains",
        json={"title": "Written before", "subtype": "domain", "parent_id": 1},
        headers={"Authorization": f"Bearer {tokens.add('writer')}"},
    )
    assert created.status_code == 201, created.text

    response = backup_server.get("/backup", headers={"Authorization": f"Bearer {SECRET}"})

    assert response.status_code == 200
    assert response.headers["content-type"] == MEDIA_TYPE
    assert response.headers["content-disposition"].startswith("attachment;")
    assert ".db" in response.headers["content-disposition"]
    copy = tmp_path / "copy.db"
    copy.write_bytes(response.content)
    assert response.content.startswith(b"SQLite format 3\x00")
    with sqlite3.connect(copy) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert "Written before" in _titles(copy)
    assert _titles(copy) == _titles(server_db)


def test_the_live_database_is_untouched(backup_server: TestClient, server_db: Path) -> None:
    before = _titles(server_db)
    main_before = _fingerprint(server_db)

    assert (
        backup_server.get("/backup", headers={"Authorization": f"Bearer {SECRET}"}).status_code
        == 200
    )

    assert _titles(server_db) == before
    assert _fingerprint(server_db) == main_before


def test_the_temporary_copy_is_deleted_afterwards(
    backup_server: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    monkeypatch.setenv("TMPDIR", str(scratch))
    monkeypatch.setattr("tempfile.tempdir", None)

    response = backup_server.get("/backup", headers={"Authorization": f"Bearer {SECRET}"})

    assert response.status_code == 200
    assert list(scratch.iterdir()) == []
