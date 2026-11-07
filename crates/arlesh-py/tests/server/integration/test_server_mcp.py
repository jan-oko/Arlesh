"""``/mcp``: Arlesh's MCP endpoint through the server, behind the connect token: Streamable HTTP
with sessions and plain JSON answers. A session is unattached until its agent attaches with a
PIN."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

INITIALIZE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "pytest", "version": "0"},
    },
}
MCP_HEADERS = {"Accept": "application/json, text/event-stream"}


def _rpc(method: str, request_id: int = 2, **params: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}


def _connected(connect_token: str, session: str | None = None) -> dict[str, str]:
    headers = {**MCP_HEADERS, "Authorization": f"Bearer {connect_token}"}
    if session is not None:
        headers["Mcp-Session-Id"] = session
    return headers


def _session(server: TestClient, connect_token: str) -> str:
    response = server.post("/mcp", json=INITIALIZE, headers=_connected(connect_token))
    assert response.status_code == 200, response.text
    return response.headers["mcp-session-id"]


def _call(
    server: TestClient, connect_token: str, session: str, tool: str, **arguments: Any
) -> dict[str, Any]:
    response = server.post(
        "/mcp",
        json=_rpc("tools/call", name=tool, arguments=arguments),
        headers=_connected(connect_token, session),
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def test_initialize_opens_a_session_and_says_it_is_not_attached(
    server: TestClient, connect_token: str
) -> None:
    response = server.post("/mcp", json=INITIALIZE, headers=_connected(connect_token))

    assert response.status_code == 200, response.text
    assert response.headers["mcp-session-id"]
    result = response.json()["result"]
    assert result["serverInfo"]["name"] == "Arlesh"
    assert "NOT ATTACHED" in result["instructions"]
    assert response.json()["id"] == 1


def test_a_device_token_does_not_open_the_mcp(server: TestClient) -> None:
    response = server.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS)

    assert response.status_code == 401
    assert response.json()["kind"] == "not_permitted"


def test_no_token_is_401(server: TestClient) -> None:
    del server.headers["Authorization"]

    assert server.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS).status_code == 401


def test_the_connect_token_does_not_open_the_board(server: TestClient, connect_token: str) -> None:
    server.headers["Authorization"] = f"Bearer {connect_token}"

    assert server.get("/board").status_code == 401
    assert server.post("/agents/pins").status_code == 401


def test_a_request_without_a_session_is_400_and_an_unknown_session_is_404(
    server: TestClient, connect_token: str
) -> None:
    missing = server.post("/mcp", json=_rpc("tools/list"), headers=_connected(connect_token))
    unknown = server.post(
        "/mcp", json=_rpc("tools/list"), headers=_connected(connect_token, "nope")
    )

    assert missing.status_code == 400
    assert unknown.status_code == 404


def test_tools_list_over_a_session(server: TestClient, connect_token: str) -> None:
    session = _session(server, connect_token)

    response = server.post(
        "/mcp", json=_rpc("tools/list"), headers=_connected(connect_token, session)
    )

    names = [tool["name"] for tool in response.json()["result"]["tools"]]
    assert response.status_code == 200, response.text
    assert {"arlesh_snapshot", "arlesh_waits", "arlesh_agents"} <= set(names)


def test_there_is_no_stream_and_delete_ends_the_session(
    server: TestClient, connect_token: str
) -> None:
    session = _session(server, connect_token)

    stream = server.get("/mcp", headers=_connected(connect_token, session))
    ended = server.delete("/mcp", headers=_connected(connect_token, session))
    again = server.delete("/mcp", headers=_connected(connect_token, session))

    assert stream.status_code == 405
    assert ended.status_code == 204
    assert again.status_code == 404


def test_an_unattached_session_may_call_only_the_attach_tool(
    server: TestClient, connect_token: str
) -> None:
    session = _session(server, connect_token)

    refused = _call(server, connect_token, session, "arlesh_snapshot", operation="load")

    assert refused["result"]["isError"] is True
    assert refused["result"]["structuredContent"]["kind"] == "not_permitted"


def test_an_unknown_tool_is_a_protocol_error_and_a_failed_tool_is_a_result(
    server: TestClient, connect_token: str
) -> None:
    session = _session(server, connect_token)
    unknown = _call(server, connect_token, session, "arlesh_nope")
    failed = _call(server, connect_token, session, "arlesh_agents", operation="status")

    assert unknown["error"]["code"] == -32602
    assert failed["result"]["isError"] is True


def test_an_unknown_method_is_a_json_rpc_error(server: TestClient, connect_token: str) -> None:
    session = _session(server, connect_token)

    response = server.post(
        "/mcp", json=_rpc("resources/list"), headers=_connected(connect_token, session)
    )

    assert response.json()["error"]["code"] == -32601


def test_a_body_that_is_not_json_is_a_parse_error(server: TestClient, connect_token: str) -> None:
    response = server.post("/mcp", content=b"{nope", headers=_connected(connect_token))

    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32700


def test_a_batch_is_answered_in_one_array_without_the_notifications(
    server: TestClient, connect_token: str
) -> None:
    session = _session(server, connect_token)

    response = server.post(
        "/mcp",
        json=[_rpc("ping", 7), {"jsonrpc": "2.0", "method": "notifications/initialized"}],
        headers=_connected(connect_token, session),
    )

    assert response.json() == [{"jsonrpc": "2.0", "id": 7, "result": {}}]


def test_an_agent_attaches_with_a_pin_and_sees_only_its_claim(
    server: TestClient,
    server_db: Path,
    domain: int,
    create: Any,
    connect_token: str,
) -> None:
    other = create("/domains", {"title": "Elsewhere", "subtype": "domain", "parent_id": 1})["id"]
    mine = domain
    with sqlite3.connect(server_db) as connection:
        for root in (mine, other):
            connection.execute(
                "INSERT INTO mcp_roots (node_kind, node_id) VALUES ('domain', ?)", (root,)
            )
    pin = server.post("/agents/pins").json()["pin"]
    session = _session(server, connect_token)
    attached = _call(
        server,
        connect_token,
        session,
        "arlesh_agents",
        operation="attach",
        pin=pin,
        session_id="pytest",
        name="writer",
        subtree={"node_type": "domain", "node_id": str(mine)},
    )["result"]["structuredContent"]
    revision = server.get("/health").headers["x-arlesh-revision"]

    inside = _call(
        server,
        connect_token,
        session,
        "arlesh_tasks",
        operation="create",
        title="Filed by an agent",
        parent_type="domain",
        parent_id=str(mine),
    )
    outside = _call(
        server,
        connect_token,
        session,
        "arlesh_tasks",
        operation="create",
        title="Not here",
        parent_type="domain",
        parent_id=str(other),
    )

    assert attached["standing"] == "active" and attached["token"]
    assert inside["result"].get("isError") is not True, inside
    assert outside["result"]["isError"] is True
    after = server.get("/health").headers["x-arlesh-revision"]
    assert int(after) > int(revision)
    with sqlite3.connect(server_db) as connection:
        writers = set(
            connection.execute(
                "SELECT source, client FROM undo_journal WHERE source = 'mcp'"
            ).fetchall()
        )
    assert writers == {("mcp", "agents")}


def test_a_second_session_cannot_claim_what_the_first_holds(
    server: TestClient, server_db: Path, domain: int, connect_token: str
) -> None:
    with sqlite3.connect(server_db) as connection:
        connection.execute(
            "INSERT INTO mcp_roots (node_kind, node_id) VALUES ('domain', ?)", (domain,)
        )
    subtree = {"node_type": "domain", "node_id": str(domain)}

    def attach(name: str) -> dict[str, Any]:
        session = _session(server, connect_token)
        pin = server.post("/agents/pins").json()["pin"]
        answer = _call(
            server,
            connect_token,
            session,
            "arlesh_agents",
            operation="attach",
            pin=pin,
            session_id=name,
            name=name,
            subtree=subtree,
        )
        content: dict[str, Any] = answer["result"]["structuredContent"]
        return content

    first = attach("first")
    second = attach("second")

    assert first["standing"] == "active"
    assert second["standing"] == "unclaimed" and "first" in second["claim_refused"]


def test_pins_and_actions_are_a_signed_in_clients(server: TestClient, connect_token: str) -> None:
    session = _session(server, connect_token)
    pin = server.post("/agents/pins").json()["pin"]
    _call(
        server,
        connect_token,
        session,
        "arlesh_agents",
        operation="attach",
        pin=pin,
        session_id="s",
        name="writer",
    )

    listed = server.get("/agents").json()
    agent = listed["agents"][0]["agent"]
    locked = server.post(f"/agents/{agent['id']}/action", json={"action": "lock", "locked": True})
    after = server.get("/agents").json()["agents"][0]
    removed = server.post(f"/agents/{agent['id']}/action", json={"action": "remove"})

    assert agent["name"] == "writer"
    assert locked.status_code == 204
    assert after["at_capacity"] == {"kind": "agent_locked"}
    assert removed.status_code == 204
    assert server.get("/agents").json()["agents"] == []


@pytest.mark.parametrize("pin", ["", "1", "00000000"])
def test_a_wrong_pin_attaches_nothing(server: TestClient, connect_token: str, pin: str) -> None:
    session = _session(server, connect_token)

    answer = _call(
        server,
        connect_token,
        session,
        "arlesh_agents",
        operation="attach",
        pin=pin,
        session_id="s",
    )

    assert answer["result"]["isError"] is True
