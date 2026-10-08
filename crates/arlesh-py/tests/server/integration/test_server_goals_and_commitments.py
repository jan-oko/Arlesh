"""The Goal and Commitment routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

Create = Callable[[str, dict[str, Any]], dict[str, Any]]


@pytest.fixture
def goal(create: Create, domain: int) -> int:
    body = {"title": "Ship it", "parent_type": "domain", "parent_id": domain}
    identifier: int = create("/goals", body)["id"]
    return identifier


@pytest.fixture
def commitment(create: Create, domain: int, one_day: Callable[[str], dict[str, Any]]) -> int:
    body = {
        "title": "Run daily",
        "parent_type": "domain",
        "parent_id": domain,
        "time_scope": one_day("2026-06-10"),
    }
    identifier: int = create("/commitments", body)["id"]
    return identifier


def test_a_created_goal_reads_back(server: TestClient, goal: int) -> None:
    assert server.get(f"/goals/{goal}").json()["title"] == "Ship it"


def test_achieving_a_stored_goal_needs_no_confirmation(server: TestClient, goal: int) -> None:
    response = server.patch(f"/goals/{goal}", json={"status": "achieved"})

    assert response.status_code == 200
    assert response.json()["status"] == "achieved"


def test_a_deleted_goal_is_gone(server: TestClient, goal: int) -> None:
    assert server.delete(f"/goals/{goal}").status_code == 204
    assert server.get(f"/goals/{goal}").status_code == 404


def test_a_duplicate_goal_is_a_new_goal(server: TestClient, goal: int, domain: int) -> None:
    response = server.post(
        f"/goals/{goal}/duplicate",
        params={"target_type": "domain", "target_id": domain, "position": 0},
    )

    assert response.status_code == 201
    assert response.json()["copy"]["id"] != goal


def test_a_goal_converts_to_a_flow(server: TestClient, goal: int) -> None:
    response = server.post(
        f"/goals/{goal}/convert-to-flow", params={"keep_dependencies": True, "map_scopes": False}
    )

    assert response.status_code == 201, response.text
    assert response.json()["title"] == "Ship it"


def test_a_created_commitment_reads_back_unresolved(server: TestClient, commitment: int) -> None:
    assert server.get(f"/commitments/{commitment}").json()["verdict"] == "unresolved"


def test_a_commitment_update_renames_it(server: TestClient, commitment: int) -> None:
    response = server.patch(f"/commitments/{commitment}", json={"title": "Run"})

    assert response.json()["title"] == "Run"


def test_pressing_kept_keeps_it(server: TestClient, commitment: int) -> None:
    response = server.post(f"/commitments/{commitment}/verdict", params={"press": "kept"})

    assert response.status_code == 200
    assert response.json()["verdict"] == "kept"


def test_a_deleted_commitment_is_gone(server: TestClient, commitment: int) -> None:
    assert server.delete(f"/commitments/{commitment}").status_code == 204
    assert server.get(f"/commitments/{commitment}").status_code == 404


def test_a_commitment_is_archived_by_hand_and_put_back(server: TestClient, commitment: int) -> None:
    archived = server.put(f"/commitments/{commitment}/archived", params={"archived": True})
    restored = server.put(f"/commitments/{commitment}/archived", params={"archived": False})

    assert archived.status_code == 200, archived.text
    assert archived.json()["archival"] != restored.json()["archival"]
