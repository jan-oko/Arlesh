"""Every failure answers with the WireError kind in its body, at the status the kind maps to."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from arlesh import errors

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

Start = Callable[..., Any]


def _refusing(start: Start, error: Exception) -> TestClient:
    app = start()

    async def refuse() -> None:
        raise error

    app.add_api_route("/refuse", refuse)
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize(("kind", "status"), sorted(EXPECTED_STATUS.items()))
def test_each_kind_answers_its_status_with_kind_message_and_details(
    start: Start, kind: str, status: int
) -> None:
    with _refusing(start, errors._BY_KIND[kind]("refused", {"reason": "because"})) as client:
        response = client.get("/refuse")

    assert response.status_code == status
    body = response.json()
    assert (body["kind"], body["message"], body["details"]) == (
        kind,
        "refused",
        {"reason": "because"},
    )


def test_every_kind_the_core_knows_has_a_status() -> None:
    assert set(EXPECTED_STATUS) == set(errors._BY_KIND)


def test_a_server_side_failure_names_its_transaction_and_a_client_one_does_not(
    start: Start,
) -> None:
    with _refusing(start, errors.DatabaseError("down")) as client:
        server_side = client.get("/refuse").json()
    with _refusing(start, errors.NotFound("gone")) as client:
        client_side = client.get("/refuse").json()

    assert server_side["transaction_id"]
    assert client_side["transaction_id"] is None


def test_a_kind_from_a_newer_core_answers_500_internal(start: Start) -> None:
    with _refusing(start, errors.ArleshError("new", None, "something_new")) as client:
        response = client.get("/refuse")

    assert response.status_code == 500
    assert response.json()["kind"] == "internal"


def test_an_unexpected_crash_answers_500_internal_without_its_trace(start: Start) -> None:
    with _refusing(start, RuntimeError("secret stack detail")) as client:
        response = client.get("/refuse")

    assert response.status_code == 500
    assert response.json()["kind"] == "internal"
    assert "secret" not in response.text


def test_a_missing_node_is_404_not_found(server: TestClient) -> None:
    response = server.get("/tasks/9999")

    assert response.status_code == 404
    assert response.json()["kind"] == "not_found"


def test_an_unknown_route_is_404_not_found(server: TestClient) -> None:
    response = server.get("/no-such-thing")

    assert response.status_code == 404
    assert response.json()["kind"] == "not_found"


def test_a_wrong_method_is_405_invalid_request(server: TestClient) -> None:
    response = server.put("/board")

    assert response.status_code == 405
    assert response.json()["kind"] == "invalid_request"


def test_a_malformed_body_is_400_invalid_request_naming_the_field(
    server: TestClient, domain: int
) -> None:
    response = server.post("/tasks", json={"parent_type": "domain", "parent_id": domain})

    assert response.status_code == 400
    body = response.json()
    assert body["kind"] == "invalid_request"
    assert body["details"]["reason"] == "validation"
    assert ["body", "title"] in [error["loc"] for error in body["details"]["errors"]]


def test_a_dependency_cycle_is_400_invalid_request(
    server: TestClient, domain: int, new_task: Callable[..., int]
) -> None:
    first, second = new_task(domain, "First"), new_task(domain, "Second")
    server.post(f"/tasks/{first}/dependencies", json={"type": "task", "id": second})

    response = server.post(f"/tasks/{second}/dependencies", json={"type": "task", "id": first})

    assert response.status_code == 400
    assert response.json()["kind"] == "invalid_request"


def test_a_child_window_outside_its_parents_is_409_containment_violated(
    server: TestClient,
    domain: int,
    new_task: Callable[..., int],
    one_day: Callable[[str], dict[str, Any]],
) -> None:
    parent = new_task(domain, "Parent", time_scope=one_day("2026-06-10"))

    response = server.post(
        "/tasks",
        json={
            "title": "Child",
            "parent_type": "task",
            "parent_id": parent,
            "time_scope": one_day("2026-06-20"),
        },
    )

    assert response.status_code == 409
    assert response.json()["kind"] == "containment_violated"


def test_an_unscoped_commitment_is_422_needs_time_scope_until_sent_with_one(
    server: TestClient, domain: int, one_day: Callable[[str], dict[str, Any]]
) -> None:
    body = {"title": "Run", "parent_type": "domain", "parent_id": domain}

    refused = server.post("/commitments", json=body)
    retried = server.post("/commitments", json={**body, "time_scope": one_day("2026-06-10")})

    assert refused.status_code == 422
    assert refused.json()["kind"] == "needs_time_scope"
    assert retried.status_code == 201


def test_a_database_failure_is_500_database(server: TestClient) -> None:
    response = server.post(
        "/tasks", json={"title": "Loose", "parent_type": "aspect", "parent_id": 1}
    )

    assert response.status_code == 500
    assert response.json()["kind"] == "database"
