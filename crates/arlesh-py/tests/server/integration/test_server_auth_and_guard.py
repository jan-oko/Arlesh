"""Bearer tokens decide who is asking; the two-writer guard decides whether the server starts."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any

import arlesh
import pytest
from arlesh.server.ports.tokens.file_token_store import FileTokenStore
from fastapi.testclient import TestClient
from loguru import logger

Start = Callable[..., Any]
Hold = Callable[[], AbstractContextManager[None]]
DOMAIN = {"title": "From a client", "subtype": "domain", "parent_id": 1}


@pytest.fixture
def logged() -> Iterator[list[str]]:
    """What the server logs while the test runs."""
    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(str(message)), level="DEBUG")
    yield lines
    logger.remove(sink)


def test_a_request_without_a_token_is_401_even_a_read(server: TestClient) -> None:
    del server.headers["Authorization"]

    response = server.get("/board")

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.json()["kind"] == "not_permitted"
    assert response.json()["details"]["reason"] == "missing_token"


def test_a_token_this_server_did_not_issue_is_401(server: TestClient) -> None:
    response = server.get("/board", headers={"Authorization": "Bearer forged"})

    assert response.status_code == 401
    assert response.json()["details"]["reason"] == "bad_token"


def test_a_revoked_token_is_refused_at_once(server: TestClient, tokens: FileTokenStore) -> None:
    tokens.revoke("tests")

    assert server.get("/board").status_code == 401


def test_the_openapi_page_needs_no_token(server: TestClient) -> None:
    del server.headers["Authorization"]

    assert server.get("/openapi.json").status_code == 200
    assert server.get("/docs").status_code == 200


def test_each_token_writes_as_its_own_client_in_the_journal(
    server: TestClient, tokens: FileTokenStore, server_db: Path
) -> None:
    for client in ("phone", "laptop"):
        token = tokens.add(client)
        response = server.post(
            "/domains", json=DOMAIN, headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 201, response.text

    with sqlite3.connect(server_db) as connection:
        clients = {row[0] for row in connection.execute("SELECT client FROM undo_journal")}

    assert {"phone", "laptop"} <= clients
    assert "desktop" not in clients


def test_a_token_for_a_name_the_core_refuses_writes_nothing(
    server: TestClient, tokens: FileTokenStore
) -> None:
    token = tokens.add("two words")

    response = server.post("/domains", json=DOMAIN, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 400
    assert response.json()["details"]["reason"] == "invalid_client"


def test_the_server_refuses_to_start_while_the_app_holds_the_database(
    start: Start, app_hold: Hold, logged: list[str]
) -> None:
    with app_hold(), pytest.raises(arlesh.NotPermitted) as refusal, TestClient(start()):
        pass

    assert refusal.value.details["reason"] == "held"
    assert any("Refusing to start" in line for line in logged)


def test_a_second_server_on_the_same_database_is_refused(server: TestClient, start: Start) -> None:
    with pytest.raises(arlesh.NotPermitted) as refusal, TestClient(start()):
        pass

    assert refusal.value.details["reason"] == "held"


def test_the_app_cannot_take_its_hold_while_the_server_runs(
    server: TestClient, server_db: Path
) -> None:
    with pytest.raises(arlesh.NotPermitted):
        arlesh.hold(server_db)


async def test_a_scripts_write_open_is_refused_while_the_server_runs(
    server: TestClient, server_db: Path
) -> None:
    with pytest.raises(arlesh.NotPermitted) as refusal:
        await arlesh.open(server_db, client="script")

    assert refusal.value.details["reason"] == "held_by_app"


def test_the_hold_is_released_on_shutdown(start: Start, server_db: Path) -> None:
    with TestClient(start()):
        pass

    arlesh.hold(server_db).release()


def test_forced_it_starts_beside_the_app_and_says_plainly_there_are_two_writers(
    start: Start, app_hold: Hold, tokens: FileTokenStore, logged: list[str]
) -> None:
    headers = {"Authorization": f"Bearer {tokens.add('tests')}"}
    with app_hold(), TestClient(start(force=True), headers=headers) as client:
        response = client.post("/domains", json=DOMAIN)

    assert response.status_code == 201
    assert any("two writers" in line for line in logged)


def test_forced_it_takes_no_hold_so_a_second_forced_server_starts_too(
    start: Start, tokens: FileTokenStore
) -> None:
    with TestClient(start(force=True)), TestClient(start(force=True)) as second:
        response = second.get("/board", headers={"Authorization": f"Bearer {tokens.add('t')}"})

    assert response.status_code == 200


def test_a_missing_database_is_created_and_migrated_at_startup(
    start: Start, tmp_path: Path
) -> None:
    path = tmp_path / "new.db"
    token = FileTokenStore.beside(path).add("tests")

    with TestClient(start(path=path), headers={"Authorization": f"Bearer {token}"}) as client:
        response = client.get("/domains", params={"subtype": "aspect"})

    assert response.status_code == 200
    assert response.json()[0]["id"] == 1
