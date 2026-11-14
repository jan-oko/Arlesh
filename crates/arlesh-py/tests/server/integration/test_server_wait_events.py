"""``/events/expectations`` and ``arlesh_waits.watch`` through the server, over a real socket: a
write to a wait an agent raised reaches the long poll as a typed change, ``agentic`` filters it,
and the MCP's ``watch`` and ``get_many`` answer the waits' states."""

from __future__ import annotations

import queue
import socket
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore

ROOT_ASPECT = 1
Start = Callable[..., ArleshServer]
MCP_HEADERS = {"Accept": "application/json, text/event-stream"}


@pytest.fixture
def live(start: Start) -> Iterator[str]:
    """The server, listening on a loopback port; its base URL."""
    app: ArleshServer = start()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(
            app, host="127.0.0.1", port=port, log_level="warning", timeout_graceful_shutdown=1
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 20
    while not server.started:
        assert time.monotonic() < deadline, "the server did not start"
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=20)


class Agent:
    """An MCP client of the server: initialises, then calls tools."""

    def __init__(self, base: str, token: str) -> None:
        self._base = base
        self._headers = {"Authorization": f"Bearer {token}", **MCP_HEADERS}
        self.agent_token = ""
        self._next = 1
        initialised = self._post(
            {
                "jsonrpc": "2.0",
                "id": 0,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "pytest", "version": "0"},
                },
            }
        )
        self._headers["Mcp-Session-Id"] = initialised.headers["mcp-session-id"]
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def attach(self, pin: str, domain: int) -> None:
        """Attaches the session as an agent claiming ``domain``, keeping its agent token."""
        attached = self.call(
            "arlesh_agents",
            operation="attach",
            pin=pin,
            session_id="pytest-session",
            name="agent-box",
            subtree={"node_type": "domain", "node_id": str(domain)},
        )
        self.agent_token = attached["token"]

    def _post(self, message: dict[str, Any]) -> httpx.Response:
        response = httpx.post(f"{self._base}/mcp", json=message, headers=self._headers, timeout=30)
        assert response.status_code < 300, response.text
        return response

    def call(self, tool: str, **arguments: Any) -> dict[str, Any]:
        """The structured result of a tool call, failing the test on an error result."""
        self._next += 1
        response = self._post(
            {
                "jsonrpc": "2.0",
                "id": self._next,
                "method": "tools/call",
                "params": {"name": tool, "arguments": arguments},
            }
        )
        message = response.json()["result"]
        assert message.get("isError") is not True, message
        structured: dict[str, Any] = message["structuredContent"]
        return structured

    def refused(self, tool: str, **arguments: Any) -> dict[str, Any]:
        """The error payload of a tool call that was refused."""
        self._next += 1
        response = self._post(
            {
                "jsonrpc": "2.0",
                "id": self._next,
                "method": "tools/call",
                "params": {"name": tool, "arguments": arguments},
            }
        )
        message = response.json()["result"]
        assert message.get("isError") is True, message
        structured: dict[str, Any] = message["structuredContent"]
        return structured


@pytest.fixture
def agent_board(
    live: str, tokens: DatabaseTokenStore, server_db: Path, connect_token: str
) -> dict[str, Any]:
    """An attached agent, a Domain open to the MCP and claimed, and an agentic Task in it."""
    admin = {"Authorization": f"Bearer {tokens.add('user')}"}
    domain = httpx.post(
        f"{live}/domains",
        json={"title": "Home", "subtype": "domain", "parent_id": ROOT_ASPECT},
        headers=admin,
    ).json()["id"]
    with sqlite3.connect(server_db) as connection:
        connection.execute(
            "INSERT INTO mcp_roots (node_kind, node_id) VALUES ('domain', ?)", (domain,)
        )
    agent = Agent(live, connect_token)
    pin = httpx.post(f"{live}/agents/pins", headers=admin).json()["pin"]
    agent.attach(pin, domain)
    token = connect_token
    task = agent.call(
        "arlesh_tasks",
        operation="create",
        title="Pick it",
        parent_type="domain",
        parent_id=str(domain),
    )
    return {"agent": agent, "token": token, "admin": admin, "task": task}


def _poll(live: str, agent_board: dict[str, Any], query: str) -> dict[str, Any]:
    response = httpx.get(
        f"{live}/events/expectations?{query}",
        headers={
            "Authorization": f"Bearer {agent_board['token']}",
            "X-Arlesh-Agent-Token": agent_board["agent"].agent_token,
        },
        timeout=60,
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    answer: dict[str, Any] = response.json()
    return answer


def _after(live: str, agent_board: dict[str, Any], cursor: dict[str, Any], extra: str) -> Any:
    """The poll that follows ``cursor``: the changes since it."""
    return _poll(live, agent_board, f"after={cursor['revision']}&epoch={cursor['epoch']}&{extra}")


def test_a_released_wait_is_a_typed_change_with_ids(live: str, agent_board: dict[str, Any]) -> None:
    agent: Agent = agent_board["agent"]
    task = agent_board["task"]
    cursor = _poll(live, agent_board, "wait=0&agentic=true")
    asked = agent.call(
        "arlesh_waits", operation="ask", task_id=task["full_id"], title="Which colour?"
    )

    created = _after(live, agent_board, cursor, "wait=20&agentic=true")
    released = httpx.patch(
        f"{live}/waits/{asked['id']}",
        json={"status": "released", "answer": "Blue"},
        headers=agent_board["admin"],
    )
    assert released.status_code == 200, released.text
    change = _after(live, agent_board, created, "wait=20&agentic=true")["changes"][0]

    assert created["changes"][0]["wait_id"] == asked["full_id"]
    assert change["change"] == "released"
    assert change["wait_id"] == asked["full_id"]
    assert change["short_id"] == asked["short_id"]
    assert change["task_id"] == task["full_id"]
    assert change["task_short_id"] == task["short_id"]
    assert (change["status"], change["archived"], change["deleted"]) == ("released", False, False)
    assert change["revision"] > 0 and change["epoch"]


def test_a_wait_that_is_not_agentic_reaches_only_the_unfiltered_poll(
    live: str, agent_board: dict[str, Any]
) -> None:
    agent: Agent = agent_board["agent"]
    everything = _poll(live, agent_board, "wait=0")
    agentic = _poll(live, agent_board, "wait=0&agentic=true")

    httpx.post(
        f"{live}/waits",
        json={"title": "By hand", "parent_type": "task", "parent_id": agent_board["task"]["id"]},
        headers=agent_board["admin"],
    )
    agent.call("arlesh_waits", operation="ask", task_id=agent_board["task"]["full_id"], title="Ask")

    heard_all = _after(live, agent_board, everything, "wait=20")
    heard_agentic = _after(live, agent_board, agentic, "wait=20&agentic=true")
    assert [c["question"] for c in heard_agentic["changes"]] == [True]
    assert len(heard_all["changes"]) == 2


def test_a_deleted_wait_is_a_change_and_watch_reads_the_states(
    live: str, agent_board: dict[str, Any]
) -> None:
    agent: Agent = agent_board["agent"]
    asked = agent.call(
        "arlesh_waits", operation="ask", task_id=agent_board["task"]["full_id"], title="Gone soon"
    )
    watched = agent.call("arlesh_waits", operation="watch", ids=[asked["full_id"]])
    cursor = _poll(live, agent_board, "wait=0&agentic=true")

    deleted = httpx.delete(f"{live}/waits/{asked['id']}", headers=agent_board["admin"])
    assert deleted.status_code == 204
    change = _after(live, agent_board, cursor, "wait=20&agentic=true")["changes"][0]
    after = agent.call("arlesh_waits", operation="get_many", ids=[asked["full_id"]])

    assert watched["waits"][0]["status"] == "pending"
    assert watched["waits"][0]["gone"] is False
    assert change["deleted"] is True and change["wait_id"] == asked["full_id"]
    assert after["waits"] == [{"id": asked["full_id"], "gone": True}]


def test_watch_refuses_an_id_that_names_no_wait(agent_board: dict[str, Any]) -> None:
    agent: Agent = agent_board["agent"]

    refusal = agent.refused("arlesh_waits", operation="watch", ids=["ffffffff"])

    assert refusal["kind"] == "not_permitted"


def test_a_poll_with_no_cursor_is_told_to_read_afresh(
    live: str, agent_board: dict[str, Any]
) -> None:
    first = _poll(live, agent_board, "wait=0&agentic=true")
    foreign = _poll(live, agent_board, f"after={first['revision']}&epoch=other&wait=0")

    assert first["reset"] is True and first["changes"] == [] and first["epoch"]
    assert foreign["reset"] is True and foreign["epoch"] == first["epoch"]


def test_a_poll_answers_at_once_when_a_wait_changed_after_its_cursor(
    live: str, agent_board: dict[str, Any]
) -> None:
    agent: Agent = agent_board["agent"]
    cursor = _poll(live, agent_board, "wait=0&agentic=true")
    asked = agent.call(
        "arlesh_waits", operation="ask", task_id=agent_board["task"]["full_id"], title="Which?"
    )

    started = time.monotonic()
    created = _poll(
        live,
        agent_board,
        f"after={cursor['revision']}&epoch={cursor['epoch']}&wait=20&agentic=true",
    )
    quiet = _poll(
        live,
        agent_board,
        f"after={created['revision']}&epoch={created['epoch']}&wait=1&agentic=true",
    )

    assert time.monotonic() - started < 15
    assert "reset" not in created
    assert [(c["change"], c["wait_id"]) for c in created["changes"]] == [
        ("created", asked["full_id"])
    ]
    assert created["revision"] >= created["changes"][0]["revision"] > cursor["revision"]
    assert quiet["changes"] == [] and "reset" not in quiet


def test_a_poll_waits_for_a_release_and_hears_it(live: str, agent_board: dict[str, Any]) -> None:
    agent: Agent = agent_board["agent"]
    asked = agent.call(
        "arlesh_waits", operation="ask", task_id=agent_board["task"]["full_id"], title="Which?"
    )
    cursor = _poll(live, agent_board, "wait=0&agentic=true")
    heard: queue.Queue[dict[str, Any]] = queue.Queue()
    query = f"after={cursor['revision']}&epoch={cursor['epoch']}&wait=20&agentic=true"
    threading.Thread(target=lambda: heard.put(_poll(live, agent_board, query)), daemon=True).start()
    time.sleep(0.5)
    assert heard.empty()

    released = httpx.patch(
        f"{live}/waits/{asked['id']}",
        json={"status": "released", "answer": "Blue"},
        headers=agent_board["admin"],
    )
    assert released.status_code == 200, released.text
    answer = heard.get(timeout=15)

    assert [(c["change"], c["status"]) for c in answer["changes"]] == [("released", "released")]


def test_the_poll_form_needs_the_bearer_token(live: str) -> None:
    refused = httpx.get(f"{live}/events/expectations?wait=0")

    assert refused.status_code == 401


def test_another_agents_waits_are_not_told_to_an_agent_with_a_different_claim(
    live: str, agent_board: dict[str, Any], server_db: Path, connect_token: str
) -> None:
    admin = agent_board["admin"]
    elsewhere = httpx.post(
        f"{live}/domains",
        json={"title": "Elsewhere", "subtype": "domain", "parent_id": ROOT_ASPECT},
        headers=admin,
    ).json()["id"]
    with sqlite3.connect(server_db) as connection:
        connection.execute(
            "INSERT INTO mcp_roots (node_kind, node_id) VALUES ('domain', ?)", (elsewhere,)
        )
    other = Agent(live, connect_token)
    pin = httpx.post(f"{live}/agents/pins", headers=admin).json()["pin"]
    other.attach(pin, elsewhere)
    headers = {
        "Authorization": f"Bearer {connect_token}",
        "X-Arlesh-Agent-Token": other.agent_token,
    }
    cursor = httpx.get(f"{live}/events/expectations?wait=0&agentic=true", headers=headers).json()

    agent_board["agent"].call(
        "arlesh_waits", operation="ask", task_id=agent_board["task"]["full_id"], title="Mine"
    )
    heard = httpx.get(
        f"{live}/events/expectations?after={cursor['revision']}&epoch={cursor['epoch']}"
        "&wait=2&agentic=true",
        headers=headers,
        timeout=30,
    ).json()

    assert heard["changes"] == [], heard


def test_the_poll_form_refuses_a_connect_token_without_an_agent_token(
    live: str, agent_board: dict[str, Any]
) -> None:
    refused = httpx.get(
        f"{live}/events/expectations?wait=0",
        headers={"Authorization": f"Bearer {agent_board['token']}"},
    )

    assert refused.status_code == 401
