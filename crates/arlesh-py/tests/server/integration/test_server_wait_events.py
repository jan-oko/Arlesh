"""``/events/expectations`` and ``arlesh_waits.watch`` through the server, over a real socket: a
write to a wait an agent raised reaches the wait stream as a typed event, ``agentic`` filters it,
and the MCP's ``watch`` and ``get_many`` answer the waits' states."""

from __future__ import annotations

import json
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
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
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
    """An MCP client of the server: initialises a session, then calls tools."""

    def __init__(self, base: str, token: str) -> None:
        self._base = base
        self._headers = {"Authorization": f"Bearer {token}", **MCP_HEADERS}
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
        self._headers["mcp-session-id"] = initialised.headers["mcp-session-id"]
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})

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
        message = _message(response.text)["result"]
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
        message = _message(response.text)["result"]
        assert message.get("isError") is True, message
        structured: dict[str, Any] = message["structuredContent"]
        return structured


def _message(body: str) -> dict[str, Any]:
    for line in body.splitlines():
        if line.startswith("data:") and line[5:].strip():
            parsed: dict[str, Any] = json.loads(line[5:])
            return parsed
    loaded: dict[str, Any] = json.loads(body)
    return loaded


def _follow(
    base: str, token: str, query: str
) -> tuple[queue.Queue[dict[str, Any]], threading.Event]:
    """Follows ``/events/expectations``; each ``wait-changed``'s data lands on the queue."""
    heard: queue.Queue[dict[str, Any]] = queue.Queue()
    connected = threading.Event()

    def follow() -> None:
        headers = {"Authorization": f"Bearer {token}", "Accept-Encoding": "gzip"}
        url = f"{base}/events/expectations{query}"
        with httpx.stream("GET", url, headers=headers, timeout=60) as response:
            name = ""
            for line in response.iter_lines():
                if line.startswith(": connected"):
                    connected.set()
                elif line.startswith("event:"):
                    name = line.removeprefix("event:").strip()
                elif line.startswith("data:") and name == "wait-changed":
                    heard.put(json.loads(line.removeprefix("data:").strip()))

    threading.Thread(target=follow, daemon=True).start()
    return heard, connected


@pytest.fixture
def agent_board(live: str, tokens: DatabaseTokenStore, server_db: Path) -> dict[str, Any]:
    """An agent's token, a Domain open to the MCP, and an agentic Task in it."""
    token = tokens.add("agent-box")
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
    agent = Agent(live, token)
    task = agent.call(
        "arlesh_tasks",
        operation="create",
        title="Pick it",
        parent_type="domain",
        parent_id=str(domain),
    )
    return {"agent": agent, "token": token, "admin": admin, "task": task}


def _wait(heard: queue.Queue[dict[str, Any]], change: str) -> dict[str, Any]:
    deadline = time.monotonic() + 15
    while True:
        event = heard.get(timeout=max(0.1, deadline - time.monotonic()))
        if event["change"] == change:
            return event


def test_a_released_wait_is_a_typed_event_with_ids(live: str, agent_board: dict[str, Any]) -> None:
    agent: Agent = agent_board["agent"]
    task = agent_board["task"]
    heard, connected = _follow(live, agent_board["token"], "?agentic=true")
    assert connected.wait(20)
    asked = agent.call(
        "arlesh_waits", operation="ask", task_id=task["full_id"], title="Which colour?"
    )

    created = _wait(heard, "created")
    released = httpx.patch(
        f"{live}/waits/{asked['id']}",
        json={"status": "released", "answer": "Blue"},
        headers=agent_board["admin"],
    )
    assert released.status_code == 200, released.text
    event = _wait(heard, "released")

    assert created["wait_id"] == asked["full_id"]
    assert event["wait_id"] == asked["full_id"]
    assert event["short_id"] == asked["short_id"]
    assert event["task_id"] == task["full_id"]
    assert event["task_short_id"] == task["short_id"]
    assert (event["status"], event["archived"], event["deleted"]) == ("released", False, False)
    assert event["revision"] > 0 and event["epoch"]


def test_a_wait_that_is_not_agentic_reaches_only_the_unfiltered_stream(
    live: str, agent_board: dict[str, Any]
) -> None:
    agent: Agent = agent_board["agent"]
    everything, all_connected = _follow(live, agent_board["token"], "")
    agentic, agentic_connected = _follow(live, agent_board["token"], "?agentic=true")
    assert all_connected.wait(20) and agentic_connected.wait(20)

    httpx.post(
        f"{live}/waits",
        json={"title": "By hand", "parent_type": "task", "parent_id": agent_board["task"]["id"]},
        headers=agent_board["admin"],
    )
    agent.call("arlesh_waits", operation="ask", task_id=agent_board["task"]["full_id"], title="Ask")

    assert _wait(everything, "created")["short_id"]
    assert [_wait(agentic, "created")["question"]] == [True]
    assert agentic.empty(), "the hand-made wait was sent on the agentic stream"


def test_a_deleted_wait_is_an_event_and_watch_reads_the_states(
    live: str, agent_board: dict[str, Any]
) -> None:
    agent: Agent = agent_board["agent"]
    asked = agent.call(
        "arlesh_waits", operation="ask", task_id=agent_board["task"]["full_id"], title="Gone soon"
    )
    watched = agent.call("arlesh_waits", operation="watch", ids=[asked["full_id"]])
    heard, connected = _follow(live, agent_board["token"], "?agentic=true")
    assert connected.wait(20)

    deleted = httpx.delete(f"{live}/waits/{asked['id']}", headers=agent_board["admin"])
    assert deleted.status_code == 204
    event = _wait(heard, "deleted")
    after = agent.call("arlesh_waits", operation="get_many", ids=[asked["full_id"]])

    assert watched["waits"][0]["status"] == "pending"
    assert watched["waits"][0]["gone"] is False
    assert event["deleted"] is True and event["wait_id"] == asked["full_id"]
    assert after["waits"] == [{"id": asked["full_id"], "gone": True}]


def test_watch_refuses_an_id_that_names_no_wait(agent_board: dict[str, Any]) -> None:
    agent: Agent = agent_board["agent"]

    refusal = agent.refused("arlesh_waits", operation="watch", ids=["ffffffff"])

    assert refusal["kind"] == "not_permitted"
