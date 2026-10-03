"""The wait, Info and Domain routes, and what any node carries: Tags and block reasons."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

Create = Callable[[str, dict[str, Any]], dict[str, Any]]
NewTask = Callable[..., int]


def _wait(create: Create, parent: int, **fields: Any) -> dict[str, Any]:
    body = {"title": "Reply from Ana", "parent_type": "task", "parent_id": parent, **fields}
    return create("/waits", body)


def test_a_wait_is_created_and_released(
    server: TestClient, create: Create, domain: int, new_task: NewTask
) -> None:
    wait = _wait(create, new_task(domain))

    response = server.patch(f"/waits/{wait['id']}", json={"status": "released"})

    assert wait["status"] == "pending"
    assert response.json()["status"] == "released"


def test_a_due_check_is_completed_and_reopened(
    server: TestClient, create: Create, domain: int, new_task: NewTask
) -> None:
    wait = _wait(
        create,
        new_task(domain),
        check_every={"n": 1, "kind": "day"},
        check_starting="2026-01-01T09:00:00",
    )

    completed = server.post(f"/waits/{wait['id']}/check/complete")
    reopened = server.post(
        f"/waits/{wait['id']}/check/reopen", params={"due_at": "2026-01-01T09:00:00"}
    )

    assert completed.status_code == 200, completed.text
    assert completed.json()["last_check_at"] is not None
    assert reopened.status_code == 200, reopened.text


def test_a_deleted_wait_is_off_the_board(
    server: TestClient, create: Create, domain: int, new_task: NewTask
) -> None:
    wait = _wait(create, new_task(domain))

    assert server.delete(f"/waits/{wait['id']}").status_code == 204
    assert wait["id"] not in [e["id"] for e in server.get("/board").json()["expectations"]]


def test_an_info_is_created_read_updated_duplicated_and_deleted(
    server: TestClient, create: Create, domain: int
) -> None:
    body = {"body": "Door code 1234", "parent_type": "domain", "parent_id": domain, "position": 0}
    identifier = create("/infos", body)["id"]

    read = server.get(f"/infos/{identifier}")
    updated = server.patch(f"/infos/{identifier}", json={"details": "back door"})
    copy = server.post(
        f"/infos/{identifier}/duplicate",
        params={"target_type": "domain", "target_id": domain, "position": 1},
    )
    deleted = server.delete(f"/infos/{identifier}")

    assert read.json()["body"] == "Door code 1234"
    assert updated.json()["details"] == "back door"
    assert copy.status_code == 201
    assert deleted.status_code == 204
    assert server.get(f"/infos/{identifier}").status_code == 404


def test_domains_list_by_subtype_and_read_one(server: TestClient, domain: int) -> None:
    aspects = server.get("/domains", params={"subtype": "aspect"}).json()

    assert {entry["subtype"] for entry in aspects} == {"aspect"}
    assert server.get(f"/domains/{domain}").json()["title"] == "Home"


def test_a_domain_is_updated_duplicated_and_deleted(server: TestClient, domain: int) -> None:
    updated = server.patch(f"/domains/{domain}", json={"title": "House"})
    copy = server.post(f"/domains/{domain}/duplicate", params={"target_id": 1, "position": 0})
    deleted = server.delete(f"/domains/{copy.json()['id']}")

    assert updated.json()["title"] == "House"
    assert copy.status_code == 201
    assert deleted.status_code == 204


def test_a_tag_is_put_on_and_taken_off_a_task(
    server: TestClient, create: Create, domain: int, new_task: NewTask
) -> None:
    tag = create("/domains", {"title": "urgent", "subtype": "tag", "parent_id": 1})["id"]
    identifier = new_task(domain)

    put = server.put(f"/nodes/task/{identifier}/tags/{tag}")
    tagged = server.get(f"/tasks/{identifier}").json()["task"]["tag_ids"]
    removed = server.delete(f"/nodes/task/{identifier}/tags/{tag}")

    assert put.status_code == 204, put.text
    assert tagged == [tag]
    assert removed.status_code == 204
    assert server.get(f"/tasks/{identifier}").json()["task"]["tag_ids"] == []


def test_a_tasks_block_reasons_are_replaced(
    server: TestClient, domain: int, new_task: NewTask
) -> None:
    identifier = new_task(domain)

    response = server.put(f"/nodes/task/{identifier}/block-reasons", json=["Waiting on parts"])

    assert response.status_code == 204, response.text
    assert "Waiting on parts" in str(server.get(f"/tasks/{identifier}").json()["block_reasons"])
