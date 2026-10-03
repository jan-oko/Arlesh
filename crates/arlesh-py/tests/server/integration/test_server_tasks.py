"""The Task routes: each one round-trips through the core."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

NewTask = Callable[..., int]
OneDay = Callable[[str], dict[str, Any]]
DONE = {"status": {"kind": "ordinary", "status": "done"}}


def test_a_created_task_reads_back_with_what_blocks_it(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    response = server.get(f"/tasks/{new_task(domain)}")

    assert response.status_code == 200
    assert response.json()["task"]["title"] == "Write it"
    assert response.json()["block_reasons"] == []


def test_an_update_changes_only_what_it_names_and_null_clears(
    server: TestClient, domain: int, new_task: NewTask, one_day: OneDay
) -> None:
    identifier = new_task(domain, time_scope=one_day("2026-06-10"))

    renamed = server.patch(f"/tasks/{identifier}", json={"title": "Renamed"})
    cleared = server.patch(f"/tasks/{identifier}", json={"time_scope": None})

    assert renamed.json()["title"] == "Renamed"
    assert renamed.json()["time_scope"]["start_id"] == {"kind": "day", "date": "2026-06-10"}
    assert cleared.json()["time_scope"] is None
    assert cleared.json()["title"] == "Renamed"


def test_an_update_naming_a_parent_moves_the_task(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    parent, child = new_task(domain, "Parent"), new_task(domain, "Child")

    response = server.patch(
        f"/tasks/{child}", json={"parent_type": "task", "parent_id": parent, "position": 0}
    )

    assert (response.json()["parent_type"], response.json()["parent_id"]) == ("task", parent)


def test_a_deleted_task_is_gone(server: TestClient, domain: int, new_task: NewTask) -> None:
    identifier = new_task(domain)

    assert server.delete(f"/tasks/{identifier}").status_code == 204
    assert server.get(f"/tasks/{identifier}").status_code == 404


def test_a_status_step_advances_the_cycle(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    response = server.post(f"/tasks/{new_task(domain)}/status", params={"step": "advance"})

    assert response.status_code == 200, response.text
    assert response.json()["outcome"] == "written"
    assert response.json()["task"]["status"]["status"] != "todo"


def test_toggling_agentic_flips_the_task(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    response = server.post(f"/tasks/{new_task(domain)}/agentic/toggle")

    assert response.status_code == 200
    assert response.json()["agentic"] is True


def test_a_dependency_is_added_read_and_removed(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    first, second = new_task(domain, "First"), new_task(domain, "Second")
    dependency = {"type": "task", "id": first}

    added = server.post(f"/tasks/{second}/dependencies", json=dependency)
    listed = server.get(f"/tasks/{second}/dependencies").json()
    removed = server.request("DELETE", f"/tasks/{second}/dependencies", json=dependency)

    assert added.status_code == 204
    assert listed == [dependency]
    assert removed.status_code == 204
    assert server.get(f"/tasks/{second}/dependencies").json() == []


def test_when_a_task_was_done_reads_and_corrects(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    identifier = new_task(domain, status=DONE["status"])

    corrected = server.put(f"/tasks/{identifier}/done-at", params={"at": "2026-06-10T09:30:00"})

    assert corrected.status_code == 204, corrected.text
    assert server.get(f"/tasks/{identifier}/done-at").json() == "2026-06-10T09:30:00"


def test_an_undone_task_has_no_done_at(server: TestClient, domain: int, new_task: NewTask) -> None:
    assert server.get(f"/tasks/{new_task(domain)}/done-at").json() is None


def test_a_duplicate_is_a_new_task_under_the_target(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    identifier = new_task(domain, "Original")

    response = server.post(
        f"/tasks/{identifier}/duplicate",
        params={"target_type": "domain", "target_id": domain, "position": 0},
    )

    assert response.status_code == 201
    assert response.json()["id"] != identifier
    assert response.json()["title"] == "Original"


def test_a_task_converts_to_a_flow(server: TestClient, domain: int, new_task: NewTask) -> None:
    response = server.post(
        f"/tasks/{new_task(domain, 'Routine')}/convert-to-flow",
        params={"keep_dependencies": False, "map_scopes": False},
    )

    assert response.status_code == 201, response.text
    assert response.json()["title"] == "Routine"


def test_an_asynchronous_tasks_spawned_wait_is_released_and_its_checks_reach_the_core(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    identifier = new_task(
        domain,
        asynchronous=True,
        async_template={"title": "Reply", "tag_ids": [], "check_every": {"n": 1, "kind": "day"}},
    )
    server.patch(f"/tasks/{identifier}", json=DONE)

    completed = server.post(f"/tasks/{identifier}/spawned-wait/check/complete")
    reopened = server.post(
        f"/tasks/{identifier}/spawned-wait/check/reopen", params={"due_at": "2026-06-11T09:00:00"}
    )
    released = server.patch(f"/tasks/{identifier}/spawned-wait", json={"status": "released"})

    # Its first check falls a day after it spawned, so none is due and none is done yet: the core
    # refuses both, in its own words.
    assert completed.json()["message"] == "there is no check due on this wait"
    assert reopened.status_code == 400
    assert "reopened" in reopened.json()["message"]
    assert released.status_code == 200, released.text
    assert released.json()["status"] == "released"
