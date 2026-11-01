"""Undo per client, and the gesture operations: each write is one Gesture of the client its token
names, and a gesture over several nodes is one request, so one undo step."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore
from fastapi.testclient import TestClient

NewTask = Callable[..., int]


def _exists(server: TestClient, task: int) -> bool:
    status: int = server.get(f"/tasks/{task}").status_code
    return status == 200


def test_a_write_is_one_undo_step_and_redo_puts_it_back(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    task = new_task(domain)

    status = server.get("/undo").json()
    undone = server.post("/undo")
    gone = not _exists(server, task)
    redone = server.post("/redo")

    assert status["undo"] is not None
    assert undone.status_code == 200 and undone.json() is not None
    assert gone
    assert redone.json() is not None
    assert _exists(server, task)


def test_an_empty_stack_answers_null(server: TestClient) -> None:
    assert server.post("/undo").json() is None
    assert server.post("/redo").json() is None


def test_each_client_undoes_only_its_own_writes(
    server: TestClient, tokens: DatabaseTokenStore, domain: int, new_task: NewTask
) -> None:
    mine = new_task(domain, "Mine")
    phone = {"Authorization": f"Bearer {tokens.add('phone')}"}
    theirs = server.post(
        "/tasks",
        json={"title": "Theirs", "parent_type": "domain", "parent_id": domain},
        headers=phone,
    ).json()["id"]

    server.post("/undo", headers=phone)

    assert not _exists(server, theirs)
    assert _exists(server, mine)


def test_deleting_several_nodes_is_one_undo_step(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    first, second = new_task(domain, "First"), new_task(domain, "Second")
    nodes: list[dict[str, Any]] = [{"kind": "task", "id": first}, {"kind": "task", "id": second}]

    deleted = server.post("/gestures/delete-nodes", json=nodes)
    server.post("/undo")

    assert deleted.status_code == 204
    assert _exists(server, first) and _exists(server, second)


def test_a_delete_that_fails_part_way_deletes_nothing(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    task = new_task(domain)

    refused = server.post(
        "/gestures/delete-nodes", json=[{"kind": "task", "id": task}, {"kind": "aspect", "id": 1}]
    )

    assert refused.status_code == 400
    assert _exists(server, task)


def test_insert_parent_names_the_node_it_made_and_is_one_undo_step(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    child = new_task(domain, "Child")
    steps = [
        {
            "op": "create_task",
            "request": {"title": "Parent", "parent_type": "domain", "parent_id": domain},
        },
        {
            "op": "move",
            "kind": "task",
            "id": child,
            "parent_kind": "task",
            "parent": {"step": 0},
            "position": 0,
        },
    ]

    answers = server.post("/gestures/insert-parent", json=steps)
    parent = answers.json()[0]["id"]
    moved_under = server.get(f"/tasks/{child}").json()["task"]["parent_id"]
    server.post("/undo")

    assert answers.status_code == 200, answers.text
    assert moved_under == parent
    assert not _exists(server, parent)
    assert server.get(f"/tasks/{child}").json()["task"]["parent_id"] == domain


def test_a_write_a_gesture_does_not_make_is_refused_before_anything_is_written(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    task = new_task(domain)

    refused = server.post(
        "/gestures/paste", json=[{"op": "delete", "node": {"kind": "task", "id": task}}]
    )

    assert refused.status_code == 400
    assert _exists(server, task)


def test_a_write_that_may_be_refused_is_taken_back_alone(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    task = new_task(domain)
    steps = [
        {"op": "update_task", "id": 99999, "request": {"title": "x"}, "may_be_refused": True},
        {"op": "update_task", "id": task, "request": {"title": "Renamed"}},
    ]

    answers = server.post("/gestures/plan-tasks", json=steps).json()

    assert answers[0]["refused"]["kind"] == "not_found"
    assert server.get(f"/tasks/{task}").json()["task"]["title"] == "Renamed"


def test_archiving_several_nodes_is_one_undo_step(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    first, second = new_task(domain, "First"), new_task(domain, "Second")
    steps = [
        {"op": "update_task", "id": task, "request": {"archival": "archived"}}
        for task in (first, second)
    ]

    archived = server.post("/gestures/archive-nodes", json=steps)
    states = [server.get(f"/tasks/{task}").json()["task"]["archival"] for task in (first, second)]
    server.post("/undo")

    assert archived.status_code == 200, archived.text
    assert states == ["archived", "archived"]
    assert server.get(f"/tasks/{first}").json()["task"]["archival"] == "live"
    assert server.get(f"/tasks/{second}").json()["task"]["archival"] == "live"


def test_archive_nodes_refuses_a_delete_before_anything_is_written(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    task = new_task(domain)

    refused = server.post(
        "/gestures/archive-nodes", json=[{"op": "delete", "node": {"kind": "task", "id": task}}]
    )

    assert refused.status_code == 400
    assert _exists(server, task)
