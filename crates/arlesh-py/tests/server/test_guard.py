"""The two-writer guard, the database the service opens, and the client a write is made as."""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

import arlesh
import pytest
from fastapi.testclient import TestClient

from arlesh_api import Settings, create_app
from tests.conftest import ROOT_ASPECT, WRITER, AppHold


def test_the_service_refuses_to_start_while_the_app_holds_the_database(
    db_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with AppHold(db_path), pytest.raises(arlesh.NotPermitted) as refusal:  # noqa: SIM117
        with TestClient(create_app(Settings(db_path=db_path))):
            pass

    assert refusal.value.details["reason"] == "held_by_app"
    assert "refusing to start" in caplog.text


def test_forced_it_starts_beside_the_app_and_says_plainly_that_there_are_two_writers(
    db_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    with AppHold(db_path), TestClient(create_app(Settings(db_path=db_path, force=True))) as client:
        response = client.post(
            "/domains",
            json={"title": "Forced", "subtype": "domain", "parent_id": ROOT_ASPECT},
            headers=WRITER,
        )

    assert response.status_code == 201
    assert "FORCED" in caplog.text
    assert "two writers" in caplog.text


def test_a_client_first_writing_after_the_app_took_the_database_is_refused_403(
    client: TestClient, db_path: Path
) -> None:
    with AppHold(db_path):
        response = client.post(
            "/domains",
            json={"title": "Late", "subtype": "domain", "parent_id": ROOT_ASPECT},
            headers={"X-Arlesh-Client": "late-comer"},
        )

    assert response.status_code == 403
    assert response.json()["kind"] == "not_permitted"
    assert response.json()["details"]["reason"] == "held_by_app"


def test_a_missing_database_is_created_and_migrated_at_startup(tmp_path: Path) -> None:
    with TestClient(create_app(Settings(db_path=tmp_path / "new.db"))) as client:
        response = client.get("/domains", params={"subtype": "aspect"})

    assert response.status_code == 200
    assert response.json()[0]["id"] == ROOT_ASPECT


def test_reads_need_no_client(client: TestClient) -> None:
    assert client.get("/board").status_code == 200


def test_a_write_without_a_client_is_refused_400_and_writes_nothing(client: TestClient) -> None:
    before = client.get("/domains").json()

    response = client.post(
        "/domains", json={"title": "Anonymous", "subtype": "domain", "parent_id": ROOT_ASPECT}
    )

    assert response.status_code == 400
    assert response.json()["kind"] == "invalid_request"
    assert ["header", "X-Arlesh-Client"] in [e["loc"] for e in response.json()["details"]["errors"]]
    assert client.get("/domains").json() == before


def test_a_client_name_the_core_does_not_accept_is_400_invalid_client(client: TestClient) -> None:
    response = client.post(
        "/domains",
        json={"title": "Odd", "subtype": "domain", "parent_id": ROOT_ASPECT},
        headers={"X-Arlesh-Client": "two words"},
    )

    assert response.status_code == 400
    assert response.json()["details"]["reason"] == "invalid_client"


def test_each_client_is_its_own_identity_in_the_journal(client: TestClient, db_path: Path) -> None:
    for name in ("phone", "laptop"):
        client.post(
            "/domains",
            json={"title": name, "subtype": "domain", "parent_id": ROOT_ASPECT},
            headers={"X-Arlesh-Client": name},
        )

    with sqlite3.connect(db_path) as connection:
        clients = {row[0] for row in connection.execute("SELECT client FROM undo_journal")}

    assert {"phone", "laptop"} <= clients
    assert "desktop" not in clients
