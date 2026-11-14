"""The routes the desktop app's Client mode needs beyond the writes: the board's lists and
what-ifs, the Flow reads, the agents and MCP roots, ``/health`` and
``/events/changes``."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any

import arlesh
import pytest
from fastapi.testclient import TestClient

Create = Callable[[str, dict[str, Any]], dict[str, Any]]
NewTask = Callable[..., int]

NOW = {"now": "2026-06-10T12:00:00"}


@pytest.mark.parametrize(
    ("path", "key"),
    [
        ("/tasks", "tasks"),
        ("/goals", "goals"),
        ("/commitments", "commitments"),
        ("/waits", "expectations"),
    ],
)
def test_each_list_is_the_boards_own(
    server: TestClient, domain: int, new_task: NewTask, path: str, key: str
) -> None:
    new_task(domain)

    listed = server.get(path, params=NOW)
    board = server.get("/board", params=NOW).json()

    assert listed.status_code == 200, listed.text
    assert [node["id"] for node in listed.json()] == [node["id"] for node in board[key]]


def test_the_board_reads_lifecycles_dependencies_and_block_reasons(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    first, second = new_task(domain, "First"), new_task(domain, "Second")
    server.post(f"/tasks/{second}/dependencies", json={"type": "task", "id": first})
    server.put(f"/nodes/task/{first}/block-reasons", json=["Waiting on parts"])

    lifecycles = server.get("/board/lifecycles", params=NOW).json()
    edges = server.get("/board/task-dependencies", params=NOW).json()
    reasons = server.get("/board/block-reasons").json()

    assert {entry["node_id"] for entry in lifecycles} >= {first, second}
    assert len(edges) == 1
    assert [reason["reason"] for reason in reasons] == ["Waiting on parts"]


def test_dependency_candidates_leave_out_what_would_close_a_cycle(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    first, second = new_task(domain, "First"), new_task(domain, "Second")
    server.post(f"/tasks/{second}/dependencies", json={"type": "task", "id": first})

    candidates = server.get(f"/tasks/{first}/dependency-candidates").json()

    assert second not in [
        candidate["id"] for candidate in candidates if candidate["type"] == "task"
    ]


def test_the_containment_what_ifs_write_nothing(
    server: TestClient,
    domain: int,
    new_task: NewTask,
    one_day: Callable[[str], dict[str, Any]],
) -> None:
    parent = new_task(domain, "Parent")
    child = server.post(
        "/tasks",
        json={
            "title": "Child",
            "parent_type": "task",
            "parent_id": parent,
            "time_scope": one_day("2026-06-10"),
        },
    ).json()["id"]

    narrowed = server.post(
        f"/nodes/task/{parent}/scope-containment-conflicts", json=one_day("2026-06-11")
    )
    moved = server.get(
        f"/nodes/task/{child}/reparent-conflicts",
        params={"parent_type": "domain", "parent_id": domain},
    )

    assert narrowed.status_code == 200, narrowed.text
    assert [entry["node_id"] for entry in narrowed.json()] == [child]
    assert moved.status_code == 200, moved.text
    assert server.get(f"/tasks/{child}").json()["task"]["parent_id"] == parent


def test_the_flow_reads(server: TestClient, create: Create) -> None:
    flow = create(
        "/flows",
        {
            "title": "Morning",
            "instance_type": "task",
            "parent_type": "aspect",
            "parent_id": 1,
            "flow_duration_n": 1,
            "flow_duration_kind": "day",
        },
    )["id"]
    item = create(
        "/flow-items/flow_task",
        {"flow_id": flow, "parent_type": "flow", "parent_id": flow, "title": "Stretch"},
    )["id"]

    assert [listed["id"] for listed in server.get("/flows").json()] == [flow]
    assert [listed["id"] for listed in server.get(f"/flows/{flow}/tasks").json()] == [item]
    assert server.get(f"/flows/{flow}/goals").json() == []
    assert [listed["id"] for listed in server.get("/flow-items/flow_task").json()] == [item]
    assert server.get("/flow-items/flow_goal").json() == []
    assert server.get("/flow-items/cycles").json() == []
    assert server.get("/flow-items/dependencies").json() == []
    assert server.get(f"/flows/{flow}/recurrence").json() is None
    assert server.get(f"/flows/{flow}/completion-count").json() == 0
    assert server.get("/flows/instance-nodes").json() == []
    assert (
        server.post("/flows/origins", json=[{"node_type": "task", "node_id": 1}]).status_code == 200
    )
    targets = server.post(
        "/flows/scope-valid-targets",
        params={"duration_n": 1, "duration_kind": "day", "anchor_date": "2026-06-10"},
        json=[{"node_type": "aspect", "node_id": 1}],
    )
    assert targets.status_code == 200, targets.text


def test_infos_list(server: TestClient, create: Create, domain: int, new_task: NewTask) -> None:
    task = new_task(domain)
    info = create(
        "/infos", {"parent_type": "task", "parent_id": task, "body": "A note", "position": 0}
    )["id"]

    assert [listed["id"] for listed in server.get("/infos").json()] == [info]


def test_an_account_lock_is_set_and_listed(server: TestClient) -> None:
    assert server.get("/agents").json() == {"agents": [], "accounts": []}

    locked = server.put("/agent-accounts/lock", json={"label": "work", "locked": True})

    assert locked.status_code == 204
    assert server.get("/agents").json()["accounts"] == [
        {"label": "work", "locked": True, "windows": []}
    ]
    server.put("/agent-accounts/lock", json={"label": "work", "locked": False})
    assert server.get("/agents").json()["accounts"][0]["locked"] is False


def test_mcp_roots_are_added_listed_and_removed(server: TestClient, domain: int) -> None:
    added = server.put(f"/mcp-access/roots/domain/{domain}")
    catalogue = server.get("/mcp-access/catalogue").json()
    seen = server.get("/mcp-access").json()
    removed = server.delete(f"/mcp-access/roots/domain/{domain}")

    assert (added.status_code, removed.status_code) == (204, 204)
    assert {"node_kind": "domain", "node_id": domain} in catalogue["roots"]
    assert any(entry["node_id"] == domain for entry in seen)
    assert server.get("/mcp-access/catalogue").json()["roots"] == []


def test_health_answers_the_api_version_behind_the_token(server: TestClient) -> None:
    answered = server.get("/health")
    refused = server.get("/health", headers={"Authorization": "Bearer nope"})

    assert answered.status_code == 200
    assert set(answered.json()) == {"api_version", "version", "commit"}
    assert refused.status_code == 401


def test_a_write_moves_the_revision_and_a_read_does_not(
    server: TestClient, domain: int, new_task: NewTask, server_db: Path
) -> None:
    # Every open of the file in this process shares one revision, so a fresh read-only open sees
    # the server's.
    board = asyncio.run(arlesh.open(server_db))
    before = board.revision

    server.get("/board")
    read = board.revision
    new_task(domain)

    assert read == before
    assert board.revision == before + 1
    asyncio.run(board.close())


def test_every_answer_carries_the_revision_and_epoch(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    before = server.get("/board", params=NOW)
    revision, epoch = int(before.headers["x-arlesh-revision"]), before.headers["x-arlesh-epoch"]

    written = server.post(
        "/tasks", json={"title": "Another", "parent_type": "domain", "parent_id": domain}
    )
    after = server.get("/board", params=NOW)

    assert epoch != ""
    assert written.headers["x-arlesh-epoch"] == epoch
    assert int(written.headers["x-arlesh-revision"]) == revision + 1
    assert int(after.headers["x-arlesh-revision"]) == revision + 1
    assert server.get("/health").headers["x-arlesh-epoch"] == epoch


def test_a_status_step_moves_the_revision_by_one(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    task = new_task(domain)
    before = int(server.get("/board", params=NOW).headers["x-arlesh-revision"])

    stepped = server.post(f"/tasks/{task}/status", params={"step": "advance"})

    assert stepped.status_code == 200, stepped.text
    assert int(stepped.headers["x-arlesh-revision"]) == before + 1


def test_the_board_is_gzipped_for_a_client_that_accepts_it(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    for number in range(8):
        new_task(domain, f"Task {number}")

    response = server.get("/board", params=NOW, headers={"Accept-Encoding": "gzip"})

    assert response.headers["content-encoding"] == "gzip"
    assert len(response.json()["tasks"]) == 8
