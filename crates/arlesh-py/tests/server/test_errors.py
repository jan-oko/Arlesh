"""Every failure answers with the WireError kind in its body, at the status the kind maps to."""

from __future__ import annotations

from pathlib import Path

import pytest
from arlesh import errors
from fastapi.testclient import TestClient

from arlesh_api import Settings, create_app
from tests.conftest import WRITER, ROOT_ASPECT, day, task

EXPECTED_STATUS = {
    "not_found": 404,
    "invalid_request": 400,
    "ambiguous_id": 400,
    "containment_violated": 409,
    "status_changed": 409,
    "needs_confirmation": 422,
    "needs_time_scope": 422,
    "not_permitted": 403,
    "database": 500,
    "internal": 500,
}


@pytest.mark.parametrize(("kind", "status"), sorted(EXPECTED_STATUS.items()))
def test_each_kind_answers_its_status_with_kind_message_and_details(
    db_path: Path, kind: str, status: int
) -> None:
    error_class = errors._BY_KIND[kind]
    app = create_app(Settings(db_path=db_path))

    async def refuse() -> None:
        raise error_class("refused", {"reason": "because"})

    app.add_api_route("/refuse", refuse)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/refuse")

    assert response.status_code == status
    assert response.json() == {"kind": kind, "message": "refused", "details": {"reason": "because"}}


def test_every_kind_the_core_knows_has_a_status() -> None:
    assert set(EXPECTED_STATUS) == set(errors._BY_KIND)


def test_a_kind_from_a_newer_core_answers_500_internal(db_path: Path) -> None:
    app = create_app(Settings(db_path=db_path))

    async def refuse() -> None:
        raise errors.ArleshError("new", None, "something_new")

    app.add_api_route("/refuse", refuse)
    with TestClient(app) as client:
        response = client.get("/refuse")

    assert response.status_code == 500
    assert response.json()["kind"] == "internal"


def test_an_unexpected_crash_answers_500_internal_without_its_trace(db_path: Path) -> None:
    app = create_app(Settings(db_path=db_path))

    async def crash() -> None:
        raise RuntimeError("secret stack detail")

    app.add_api_route("/crash", crash)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/crash")

    assert response.status_code == 500
    assert response.json()["kind"] == "internal"
    assert "secret" not in response.text


def test_a_missing_node_is_404_not_found(client: TestClient) -> None:
    response = client.get("/tasks/9999")

    assert response.status_code == 404
    assert response.json()["kind"] == "not_found"


def test_an_unknown_route_is_404_not_found(client: TestClient) -> None:
    response = client.get("/no-such-thing")

    assert response.status_code == 404
    assert response.json()["kind"] == "not_found"


def test_a_malformed_body_is_400_invalid_request_naming_the_field(
    client: TestClient, domain: int
) -> None:
    response = client.post("/tasks", json={"parent_type": "domain"}, headers=WRITER)

    assert response.status_code == 400
    body = response.json()
    assert body["kind"] == "invalid_request"
    assert body["details"]["reason"] == "validation"
    assert ["body", "title"] in [error["loc"] for error in body["details"]["errors"]]


def test_a_dependency_cycle_is_400_invalid_request(client: TestClient, domain: int) -> None:
    first, second = task(client, domain, "First"), task(client, domain, "Second")
    client.post(f"/tasks/{first}/dependencies", json={"type": "task", "id": second}, headers=WRITER)

    response = client.post(
        f"/tasks/{second}/dependencies", json={"type": "task", "id": first}, headers=WRITER
    )

    assert response.status_code == 400
    assert response.json()["kind"] == "invalid_request"


def test_a_child_window_outside_its_parents_is_409_containment_violated(
    client: TestClient, domain: int
) -> None:
    parent = task(client, domain, "Parent", time_scope=day("2026-06-10"))

    response = client.post(
        "/tasks",
        json={
            "title": "Child",
            "parent_type": "task",
            "parent_id": parent,
            "time_scope": day("2026-06-20"),
        },
        headers=WRITER,
    )

    assert response.status_code == 409
    assert response.json()["kind"] == "containment_violated"


def test_an_unscoped_commitment_is_422_needs_time_scope_until_sent_with_one(
    client: TestClient, domain: int
) -> None:
    body = {"title": "Run", "parent_type": "domain", "parent_id": domain}

    refused = client.post("/commitments", json=body, headers=WRITER)
    retried = client.post(
        "/commitments", json={**body, "time_scope": day("2026-06-10")}, headers=WRITER
    )

    assert refused.status_code == 422
    assert refused.json()["kind"] == "needs_time_scope"
    assert retried.status_code == 201


def test_a_database_failure_is_500_database(client: TestClient) -> None:
    response = client.post(
        "/tasks",
        json={"title": "Loose", "parent_type": "aspect", "parent_id": ROOT_ASPECT},
        headers=WRITER,
    )

    assert response.status_code == 500
    assert response.json()["kind"] == "database"
