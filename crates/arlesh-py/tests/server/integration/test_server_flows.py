"""The Flow and Habit routes, their items, and the composite operations over them."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

Create = Callable[[str, dict[str, Any]], dict[str, Any]]


def _flow(create: Create, title: str = "Morning", **fields: Any) -> int:
    body = {
        "title": title,
        "instance_type": "task",
        "parent_type": "aspect",
        "parent_id": 1,
        "flow_duration_n": 1,
        "flow_duration_kind": "day",
        **fields,
    }
    identifier: int = create("/flows", body)["id"]
    return identifier


def _item(create: Create, flow: int, kind: str, title: str) -> int:
    body = {"flow_id": flow, "parent_type": "flow", "parent_id": flow, "title": title}
    identifier: int = create(f"/flow-items/{kind}", body)["id"]
    return identifier


def _habit(server: TestClient, flow: int) -> dict[str, Any]:
    response = server.put(
        f"/flows/{flow}/recurrence",
        json={"start_scope_id": {"kind": "day", "date": "2026-01-05"}, "clock": "interval"},
    )
    assert response.status_code == 200, response.text
    recurrence: dict[str, Any] = response.json()
    return recurrence


def test_a_flow_is_created_read_updated_and_deleted(server: TestClient, create: Create) -> None:
    identifier = _flow(create)

    read = server.get(f"/flows/{identifier}")
    updated = server.patch(f"/flows/{identifier}", json={"title": "Evening"})
    deleted = server.delete(f"/flows/{identifier}")

    assert read.json()["title"] == "Morning"
    assert updated.json()["title"] == "Evening"
    assert deleted.status_code == 204
    assert server.get(f"/flows/{identifier}").status_code == 404


def test_items_are_created_updated_ordered_duplicated_and_deleted(
    server: TestClient, create: Create
) -> None:
    flow = _flow(create)
    goal = _item(create, flow, "flow_goal", "Be ready")
    first = _item(create, flow, "flow_task", "Stretch")
    second = _item(create, flow, "flow_task", "Shower")

    goal_renamed = server.patch(f"/flow-items/flow_goal/{goal}", json={"title": "Ready"})
    task_renamed = server.patch(f"/flow-items/flow_task/{first}", json={"title": "Stretch well"})
    ordered = server.post(
        f"/flows/{flow}/dependencies",
        params={
            "dependent_type": "flow_task",
            "dependent_id": second,
            "depends_on_type": "flow_task",
            "depends_on_id": first,
        },
    )
    unordered = server.delete(f"/flow-items/flow_task/{second}/dependencies/flow_task/{first}")
    copy = server.post(
        f"/flow-items/flow_task/{first}/duplicate",
        params={"parent_type": "flow", "parent_id": flow, "position": 0},
    )
    deleted = server.delete(f"/flow-items/flow_goal/{goal}")

    assert goal_renamed.json()["title"] == "Ready"
    assert task_renamed.json()["title"] == "Stretch well"
    assert ordered.status_code == 204, ordered.text
    assert unordered.status_code == 204, unordered.text
    assert copy.status_code == 201, copy.text
    assert copy.json() not in (first, second)
    assert deleted.status_code == 204


def test_an_items_cycles_are_set(server: TestClient, create: Create) -> None:
    flow = _flow(create, flow_duration_n=2)
    item = _item(create, flow, "flow_task", "Stretch")

    response = server.put(
        f"/flow-items/flow_task/{item}/cycles",
        params={"flow_id": flow},
        json=[{"scope_index": 0, "scope_kind": "day"}],
    )

    assert response.status_code == 200, response.text
    assert response.json() is None


def test_starting_a_flow_materialises_it_under_a_target(
    server: TestClient, create: Create, domain: int
) -> None:
    flow = _flow(create)
    _item(create, flow, "flow_task", "Stretch")

    response = server.post(
        f"/flows/{flow}/start",
        json={
            "anchor_date": "2026-06-10",
            "target_type": "domain",
            "target_id": domain,
            "title": "Morning, 10 June",
        },
    )

    assert response.status_code == 201, response.text
    started = server.get(f"/tasks/{response.json()['root_id']}").json()["task"]
    assert started["title"] == "Morning, 10 June"


def test_a_habits_recurrence_is_set_cleared_and_its_edits_dropped(
    server: TestClient, create: Create
) -> None:
    flow = _flow(create)

    recurrence = _habit(server, flow)
    cleared_edits = server.delete(f"/flows/{flow}/habit-modifications")
    removed = server.delete(f"/flows/{flow}/recurrence")

    assert recurrence["clock"] == "interval"
    assert cleared_edits.status_code == 204, cleared_edits.text
    assert removed.status_code == 204, removed.text


def test_a_habit_forks_and_a_flow_duplicates(server: TestClient, create: Create) -> None:
    flow = _flow(create)
    _habit(server, flow)

    forked = server.post(f"/flows/{flow}/fork", params={"now": "2026-01-10T09:00:00"})
    copy = server.post(
        f"/flows/{flow}/duplicate",
        params={"parent_type": "aspect", "parent_id": 1, "position": 0},
    )

    assert forked.status_code == 201, forked.text
    assert forked.json()["id"] != flow
    assert copy.status_code == 201, copy.text
