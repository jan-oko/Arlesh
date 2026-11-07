"""The confirmation protocol: refused 422 naming what is at stake, then done when confirmed.

The scenario of the Rust integration tests in ``src-tauri/tests/flows/occurrence_children.rs``:
a daily Habit from 2026-01-05, a Task hung on its first occurrence, and that occurrence completed.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

DONE = {"status": {"kind": "ordinary", "status": "done"}}
Create = Callable[[str, dict[str, Any]], dict[str, Any]]


def _occurrence_with_unfinished_child(server: TestClient, create: Create) -> str:
    flow = create(
        "/flows",
        {
            "title": "Groceries",
            "instance_type": "task",
            "parent_type": "aspect",
            "parent_id": 1,
            "flow_duration_n": 1,
            "flow_duration_kind": "day",
        },
    )
    recurrence = server.put(
        f"/flows/{flow['id']}/recurrence",
        json={"start_scope_id": {"kind": "day", "date": "2026-01-05"}, "clock": "interval"},
    )
    assert recurrence.status_code == 200, recurrence.text
    board = server.get("/board", params={"now": "2026-01-05T09:00:00"}).json()
    occurrence: str = next(
        node["id"]
        for node in board["tasks"]
        if node["title"] == "Groceries" and isinstance(node["id"], str)
    )
    create("/tasks", {"title": "buy milk", "parent_type": "task", "parent_id": occurrence})
    return occurrence


def test_completing_an_occurrence_over_unfinished_work_asks_first_and_names_it(
    server: TestClient, create: Create
) -> None:
    occurrence = _occurrence_with_unfinished_child(server, create)

    response = server.patch(f"/tasks/{occurrence}", json=DONE)

    assert response.status_code == 422
    body = response.json()
    assert body["kind"] == "needs_confirmation"
    assert body["details"]["reason"] == "unfinished_children"
    assert "buy milk" in str(body["details"]["children"])


def test_sent_again_confirmed_it_completes_the_occurrence(
    server: TestClient, create: Create
) -> None:
    occurrence = _occurrence_with_unfinished_child(server, create)
    server.patch(f"/tasks/{occurrence}", json=DONE)

    response = server.patch(f"/tasks/{occurrence}", params={"confirmed": True}, json=DONE)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == {"kind": "ordinary", "status": "done"}
