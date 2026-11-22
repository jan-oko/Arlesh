"""The wait, Info and Domain routes, and what any node carries: Tags and block reasons."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

ROOT_ASPECT = "4440ccd1-f5c6-5057-898c-f89df62d6f60"
"""The Domain row a fresh database is seeded with first (id: the v5 of ``domain:1``)."""

Create = Callable[[str, dict[str, Any]], dict[str, Any]]
NewTask = Callable[..., str]


def _wait(create: Create, parent: str, **fields: Any) -> dict[str, Any]:
    body = {"title": "Reply from Ana", "parent_type": "task", "parent_id": parent, **fields}
    return create("/waits", body)


def test_a_wait_is_created_and_released(
    server: TestClient, create: Create, domain: str, new_task: NewTask
) -> None:
    wait = _wait(create, new_task(domain))

    response = server.patch(f"/waits/{wait['id']}", json={"status": "released"})

    assert wait["status"] == "pending"
    assert response.json()["status"] == "released"


def test_a_due_check_is_completed_and_reopened(
    server: TestClient, create: Create, domain: str, new_task: NewTask
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
    server: TestClient, create: Create, domain: str, new_task: NewTask
) -> None:
    wait = _wait(create, new_task(domain))

    assert server.delete(f"/waits/{wait['id']}").status_code == 204
    assert wait["id"] not in [e["id"] for e in server.get("/board").json()["expectations"]]


def _question(
    server: TestClient, create: Create, domain: str, new_task: NewTask, title: str = "Colour?"
) -> str:
    """An open agentic question under an agentic Task."""
    task = new_task(domain)
    assert server.post(f"/tasks/{task}/agentic/toggle").json()["agentic"] is True
    return str(_wait(create, task, title=title, agentic=True, agentic_note="Which?")["id"])


def test_an_answer_is_staged_and_unstaged_without_releasing_the_wait(
    server: TestClient, create: Create, domain: str, new_task: NewTask
) -> None:
    wait = _question(server, create, domain, new_task)

    staged = server.put(f"/waits/{wait}/draft", json={"answer": " blue "})
    still_pending = next(e for e in server.get("/board").json()["expectations"] if e["id"] == wait)
    cleared = server.delete(f"/waits/{wait}/draft")
    cleared_again = server.delete(f"/waits/{wait}/draft")

    assert staged.status_code == 200, staged.text
    assert staged.json()["answer"] == "blue"
    assert still_pending["status"] == "pending"
    assert cleared.status_code == 204 and cleared_again.status_code == 204


def test_a_blank_answer_cannot_be_staged(
    server: TestClient, create: Create, domain: str, new_task: NewTask
) -> None:
    wait = _question(server, create, domain, new_task)

    refused = server.put(f"/waits/{wait}/draft", json={"answer": "  "})

    assert refused.status_code == 422 or refused.status_code == 400, refused.text


def test_sending_releases_every_staged_wait_and_names_the_skipped(
    server: TestClient, create: Create, domain: str, new_task: NewTask
) -> None:
    staged = _question(server, create, domain, new_task, "Colour?")
    unstaged = _question(server, create, domain, new_task, "Shape?")
    server.put(f"/waits/{staged}/draft", json={"answer": "blue"})

    sent = server.post("/drafts/send", json={"shown": [staged, unstaged]})

    assert sent.status_code == 200, sent.text
    assert [entry["wait_id"] for entry in sent.json()["sent"]] == [staged]
    assert [(e["wait_id"], e["reason"]) for e in sent.json()["skipped"]] == [(unstaged, "unstaged")]
    waits = {e["id"]: e for e in server.get("/board").json()["expectations"]}
    assert waits[staged]["status"] == "released" and waits[staged]["answer"] == "blue"
    assert waits[unstaged]["status"] == "pending"


def test_an_info_is_created_read_updated_duplicated_and_deleted(
    server: TestClient, create: Create, domain: str
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


def test_domains_list_by_subtype_and_read_one(server: TestClient, domain: str) -> None:
    aspects = server.get("/domains", params={"subtype": "aspect"}).json()

    assert {entry["subtype"] for entry in aspects} == {"aspect"}
    assert server.get(f"/domains/{domain}").json()["title"] == "Home"


def test_a_domain_is_updated_duplicated_and_deleted(server: TestClient, domain: str) -> None:
    updated = server.patch(f"/domains/{domain}", json={"title": "House"})
    copy = server.post(
        f"/domains/{domain}/duplicate", params={"target_id": ROOT_ASPECT, "position": 0}
    )
    deleted = server.delete(f"/domains/{copy.json()['copy']['id']}")

    assert updated.json()["title"] == "House"
    assert copy.status_code == 201
    assert deleted.status_code == 204


def test_a_duplicated_domain_with_a_sub_domain_and_a_task_is_deleted_with_its_content(
    server: TestClient, create: Create, domain: str, new_task: NewTask
) -> None:
    create("/domains", {"title": "Inner", "subtype": "domain", "parent_id": domain})
    new_task(domain)
    copy = server.post(
        f"/domains/{domain}/duplicate", params={"target_id": ROOT_ASPECT, "position": 0}
    )
    copy_id = copy.json()["copy"]["id"]

    deleted = server.delete(f"/domains/{copy_id}")

    assert deleted.status_code == 204, deleted.text
    assert server.get(f"/domains/{copy_id}").status_code == 404
    assert server.get(f"/domains/{domain}").status_code == 200


def test_a_tag_is_put_on_and_taken_off_a_task(
    server: TestClient, create: Create, domain: str, new_task: NewTask
) -> None:
    tag = create("/domains", {"title": "urgent", "subtype": "tag", "parent_id": ROOT_ASPECT})["id"]
    identifier = new_task(domain)

    put = server.put(f"/nodes/task/{identifier}/tags/{tag}")
    tagged = server.get(f"/tasks/{identifier}").json()["task"]["tag_ids"]
    removed = server.delete(f"/nodes/task/{identifier}/tags/{tag}")

    assert put.status_code == 204, put.text
    assert tagged == [tag]
    assert removed.status_code == 204
    assert server.get(f"/tasks/{identifier}").json()["task"]["tag_ids"] == []


def test_a_tasks_block_reasons_are_replaced(
    server: TestClient, domain: str, new_task: NewTask
) -> None:
    identifier = new_task(domain)

    response = server.put(f"/nodes/task/{identifier}/block-reasons", json=["Waiting on parts"])

    assert response.status_code == 204, response.text
    assert "Waiting on parts" in str(server.get(f"/tasks/{identifier}").json()["block_reasons"])
