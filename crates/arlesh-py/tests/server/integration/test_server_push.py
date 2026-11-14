"""Push notifications: a device registers, and each kind of event is sent to it once, on its own
channel, through a fake push service."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta
from typing import Any

import pytest
from arlesh.server.business_logic.notifier import Notifier
from arlesh.server.ports.push.database_push_store import DatabasePushStore
from arlesh.server.ports.push.push_sender import Delivery, PushSender
from arlesh.server.ports.push.push_store import PushEvent
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore
from fastapi.testclient import TestClient

Create = Callable[[str, dict[str, Any]], dict[str, Any]]
NewTask = Callable[..., int]
Start = Callable[..., Any]

PHONE_TOKEN = "fcm-token-of-the-phone"


class FakeSender(PushSender):
    """A push service that records what it was asked to send, and answers ``delivery``."""

    def __init__(self, delivery: Delivery = Delivery.accepted) -> None:
        self.delivery = delivery
        self.sent: list[tuple[str, PushEvent]] = []
        self.closed = False

    @property
    def project_id(self) -> str:
        return "fake-project"

    async def send(self, fcm_token: str, event: PushEvent) -> Delivery:
        self.sent.append((fcm_token, event))
        return self.delivery

    async def aclose(self) -> None:
        self.closed = True

    def channels(self, fcm_token: str) -> list[str]:
        """The channel of each message sent to the device holding ``fcm_token``, in order."""
        return [event.channel.value for token, event in self.sent if token == fcm_token]


@pytest.fixture
def sender() -> FakeSender:
    return FakeSender()


@pytest.fixture
def phone(tokens: DatabaseTokenStore) -> dict[str, str]:
    """The headers of the device that registers for push."""
    return {"Authorization": f"Bearer {tokens.add('phone')}"}


@pytest.fixture
def server(start: Start, tokens: DatabaseTokenStore, sender: FakeSender) -> Iterator[TestClient]:
    """The server with a push service, reached as client ``tests``. It stands in for the suite's
    own ``server``, so the fixtures built on that one (``domain``, ``create``) use this."""
    headers = {"Authorization": f"Bearer {tokens.add('tests')}"}
    with TestClient(start(sender=sender), headers=headers) as client:
        yield client


def set_capacity(client: TestClient, database: Any, at_capacity: bool) -> None:
    """Puts an agent holding the root Aspect at capacity, or back in room: the account's lock."""
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT OR IGNORE INTO mcp_roots (node_kind, node_id) VALUES ('domain', 1)"
        )
        connection.execute(
            "INSERT OR IGNORE INTO agents (name, account, session_uuid, token_sha256, claim_kind, "
            "claim_id, claimed_at, created_at) VALUES ('agent', 'work', 's', 'digest', "
            "'domain', 1, '2026-11-04T09:00:00', '2026-11-04T09:00:00')"
        )
    locked = client.put("/agent-accounts/lock", json={"label": "work", "locked": at_capacity})
    assert locked.status_code == 204, locked.text


def look(client: TestClient) -> int:
    """Has the server's notifier look at the board now, on the server's own loop."""
    notifier = client.app.notifier  # type: ignore[attr-defined]
    return int(client.portal.call(notifier.look))  # type: ignore[union-attr]


def register(client: TestClient, phone: dict[str, str], token: str = PHONE_TOKEN) -> Any:
    return client.put("/devices/current/push", json={"fcm_token": token}, headers=phone)


def domain_of(client: TestClient) -> int:
    """A Domain under the root Aspect."""
    created = client.post("/domains", json={"title": "Home", "subtype": "domain", "parent_id": 1})
    assert created.status_code == 201, created.text
    return int(created.json()["id"])


def ask(client: TestClient, parent: int, title: str = "Which one?") -> int:
    """An agent's Task under ``parent``, with a question open on it."""
    task = client.post(
        "/tasks",
        json={
            "title": "Pick a name",
            "parent_type": "domain",
            "parent_id": parent,
            "agentic": "yes",
            "status": {"kind": "agentic", "status": "on_agent"},
        },
    )
    assert task.status_code == 201, task.text
    wait = client.post(
        "/waits",
        json={
            "title": title,
            "parent_type": "task",
            "parent_id": task.json()["id"],
            "agentic": True,
            "question": True,
        },
    )
    assert wait.status_code == 201, wait.text
    return int(task.json()["id"])


def test_the_server_says_whether_it_can_push(server: TestClient) -> None:
    assert server.get("/push").json() == {"enabled": True, "project_id": "fake-project"}


def test_a_server_without_credentials_says_so(start: Start, tokens: DatabaseTokenStore) -> None:
    headers = {"Authorization": f"Bearer {tokens.add('tests')}"}
    with TestClient(start(), headers=headers) as bare:
        assert bare.get("/push").json() == {"enabled": False}


def test_a_device_registers_and_unregisters(server: TestClient, phone: dict[str, str]) -> None:
    assert register(server, phone).json() == {"new": True}
    assert register(server, phone, "rotated").json() == {"new": False}
    listed = {device["name"]: device["push"] for device in server.get("/devices").json()}
    assert listed == {"phone": True, "tests": False}

    assert server.delete("/devices/current/push", headers=phone).status_code == 204

    assert server.get("/devices").json()[0]["push"] is False


def test_revoking_a_device_takes_its_push_registration_with_it(
    server: TestClient, phone: dict[str, str], server_db: Any
) -> None:
    register(server, phone)

    assert server.delete("/devices/phone").status_code == 204

    assert DatabasePushStore(server_db).devices() == []


def test_without_credentials_the_server_takes_registrations_and_sends_nothing(
    start: Start, tokens: DatabaseTokenStore, phone: dict[str, str]
) -> None:
    headers = {"Authorization": f"Bearer {tokens.add('tests')}"}
    with TestClient(start(), headers=headers) as bare:
        assert register(bare, phone).status_code == 200
        ask(bare, domain_of(bare))

        assert look(bare) == 0


def test_each_of_the_five_events_is_one_notification_on_its_own_channel(
    server: TestClient, phone: dict[str, str], sender: FakeSender, domain: int, server_db: Any
) -> None:
    register(server, phone)

    task = ask(server, domain)
    look(server)
    question = sender.sent[0][1]
    assert (question.task, question.title) == (f"task-{task}", "Pick a name")

    set_capacity(server, server_db, True)
    look(server)
    set_capacity(server, server_db, False)
    look(server)

    morning = {"kind": "part_of_day", "date": "2020-01-01", "part": "morning"}
    late = server.post(
        "/tasks",
        json={
            "title": "Late",
            "parent_type": "domain",
            "parent_id": domain,
            "time_scope": {"start_id": morning, "end_id": morning},
        },
    )
    assert late.status_code == 201, late.text
    look(server)

    waiting = server.post(
        "/tasks", json={"title": "Wait for Ana", "parent_type": "domain", "parent_id": domain}
    ).json()["id"]
    server.post(
        "/waits",
        json={
            "title": "Reply",
            "parent_type": "task",
            "parent_id": waiting,
            "check_every": {"n": 1, "kind": "day"},
            "check_starting": (datetime.now() - timedelta(seconds=1)).isoformat(timespec="seconds"),
        },
    )
    look(server)

    assert sender.channels(PHONE_TOKEN) == [
        "agent_question",
        "capacity_locked",
        "capacity_cleared",
        "task_overdue",
        "task_generated",
    ]


def test_an_agent_at_capacity_is_told_when_it_starts_and_when_it_ends(
    server: TestClient, phone: dict[str, str], sender: FakeSender, server_db: Any
) -> None:
    register(server, phone)

    set_capacity(server, server_db, True)
    look(server)
    set_capacity(server, server_db, False)
    look(server)

    assert sender.channels(PHONE_TOKEN) == ["capacity_locked", "capacity_cleared"]


def test_a_generated_task_is_told_when_a_check_falls_due(
    server: TestClient, phone: dict[str, str], sender: FakeSender, domain: int
) -> None:
    register(server, phone)
    task = server.post(
        "/tasks", json={"title": "Wait for Ana", "parent_type": "domain", "parent_id": domain}
    ).json()["id"]
    server.post(
        "/waits",
        json={
            "title": "Reply",
            "parent_type": "task",
            "parent_id": task,
            "check_every": {"n": 1, "kind": "day"},
            "check_starting": "2020-01-01T09:00:00",
        },
    )

    look(server)

    assert "task_generated" in sender.channels(PHONE_TOKEN)
    assert sender.channels(PHONE_TOKEN).count("task_generated") == 1


def test_what_was_sent_is_not_sent_again(
    server: TestClient, phone: dict[str, str], sender: FakeSender, domain: int
) -> None:
    register(server, phone)
    ask(server, domain)

    look(server)
    look(server)
    look(server)

    assert len(sender.sent) == 1


def test_a_restart_does_not_send_again(
    start: Start,
    tokens: DatabaseTokenStore,
    phone: dict[str, str],
    sender: FakeSender,
) -> None:
    headers = {"Authorization": f"Bearer {tokens.add('tests')}"}
    with TestClient(start(sender=sender), headers=headers) as first:
        register(first, phone)
        ask(first, domain_of(first))
        look(first)
    assert len(sender.sent) == 1

    after = FakeSender()
    with TestClient(start(sender=after), headers=headers) as second:
        look(second)

    assert after.sent == []


def test_a_device_that_registers_hears_nothing_of_what_was_already_so(
    server: TestClient, phone: dict[str, str], sender: FakeSender, domain: int
) -> None:
    ask(server, domain)

    register(server, phone)
    look(server)

    assert sender.sent == []


def test_a_token_the_push_service_no_longer_knows_is_dropped(
    server: TestClient, phone: dict[str, str], sender: FakeSender, server_db: Any
) -> None:
    register(server, phone)
    sender.delivery = Delivery.unregistered

    set_capacity(server, server_db, True)
    look(server)

    assert DatabasePushStore(server_db).devices() == []


def test_a_failed_send_is_tried_again_at_the_next_look(
    server: TestClient, phone: dict[str, str], sender: FakeSender, server_db: Any
) -> None:
    register(server, phone)
    set_capacity(server, server_db, True)
    sender.delivery = Delivery.failed
    assert look(server) == 0

    sender.delivery = Delivery.accepted
    assert look(server) == 1

    assert sender.channels(PHONE_TOKEN) == ["capacity_locked", "capacity_locked"]


def test_the_notifier_is_the_one_the_server_built(server: TestClient) -> None:
    assert isinstance(server.app.notifier, Notifier)  # type: ignore[attr-defined]
    assert asyncio.iscoroutinefunction(server.app.notifier.look)  # type: ignore[attr-defined]
