"""The confirmation protocol: refused 422 naming what is at stake, then done when confirmed.

The same scenario as the Rust integration tests in
``src-tauri/tests/flows/occurrence_children.rs``: a daily Habit from 2026-01-05, a Task hung on
its first occurrence, and that occurrence completed.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import ROOT_ASPECT, WRITER, create

DONE = {"status": {"kind": "ordinary", "status": "done"}}


def _occurrence_with_unfinished_child(client: TestClient) -> str:
    flow = create(
        client,
        "/flows",
        {
            "title": "Groceries",
            "instance_type": "task",
            "parent_type": "aspect",
            "parent_id": ROOT_ASPECT,
            "flow_duration_n": 1,
            "flow_duration_kind": "day",
        },
    )
    recurrence = client.put(
        f"/flows/{flow['id']}/recurrence",
        json={"start_scope_id": {"kind": "day", "date": "2026-01-05"}, "clock": "interval"},
        headers=WRITER,
    )
    assert recurrence.status_code == 200, recurrence.text
    occurrence = _first_occurrence(client, "Groceries")
    create(client, "/tasks", {"title": "buy milk", "parent_type": "task", "parent_id": occurrence})
    return occurrence


def _first_occurrence(client: TestClient, title: str) -> str:
    board = client.get("/board", params={"now": "2026-01-05T09:00:00"}).json()
    roots: list[dict[str, Any]] = [
        node for node in board["tasks"] if node["title"] == title and isinstance(node["id"], str)
    ]
    identifier: str = roots[0]["id"]
    return identifier


def test_completing_an_occurrence_over_unfinished_work_asks_first_and_names_it(
    client: TestClient,
) -> None:
    occurrence = _occurrence_with_unfinished_child(client)

    response = client.patch(f"/tasks/{occurrence}", json=DONE, headers=WRITER)

    assert response.status_code == 422
    body = response.json()
    assert body["kind"] == "needs_confirmation"
    assert body["details"]["reason"] == "unfinished_children"
    assert "buy milk" in str(body["details"]["children"])


def test_sent_again_confirmed_it_completes_the_occurrence(client: TestClient) -> None:
    occurrence = _occurrence_with_unfinished_child(client)
    client.patch(f"/tasks/{occurrence}", json=DONE, headers=WRITER)

    response = client.patch(
        f"/tasks/{occurrence}", params={"confirmed": True}, json=DONE, headers=WRITER
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == {"kind": "ordinary", "status": "done"}
