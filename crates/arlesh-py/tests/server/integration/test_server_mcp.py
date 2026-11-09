"""``/mcp``: Arlesh's MCP endpoint through the server, behind the token: stateless Streamable HTTP,
plain JSON answers."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore
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


def test_an_authorised_initialize_answers_with_the_servers_info_and_no_session(
    server: TestClient,
) -> None:
    response = server.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS)

    assert response.status_code == 200, response.text
    assert "mcp-session-id" not in response.headers
    result = response.json()["result"]
    assert result["serverInfo"]["name"] == "Arlesh"
    assert "arlesh_snapshot" in result["instructions"]
    assert response.json()["id"] == 1


def test_an_unauthorised_initialize_is_401(server: TestClient) -> None:
    del server.headers["Authorization"]

    response = server.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS)

    assert response.status_code == 401
    assert response.json()["kind"] == "not_permitted"


def test_tools_list_without_a_session(server: TestClient) -> None:
    response = server.post("/mcp", json=_rpc("tools/list"), headers=MCP_HEADERS)

    names = [tool["name"] for tool in response.json()["result"]["tools"]]
    assert response.status_code == 200, response.text
    assert "arlesh_snapshot" in names and "arlesh_waits" in names


def test_ping_is_answered_and_a_notification_is_accepted(server: TestClient) -> None:
    ping = server.post("/mcp", json=_rpc("ping"), headers=MCP_HEADERS)
    note = server.post(
        "/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers=MCP_HEADERS
    )

    assert ping.json() == {"jsonrpc": "2.0", "id": 2, "result": {}}
    assert note.status_code == 202 and note.content == b""


@pytest.mark.parametrize("method", ["GET", "DELETE"])
def test_there_is_no_stream_and_no_session_to_end(server: TestClient, method: str) -> None:
    response = server.request(method, "/mcp", headers=MCP_HEADERS)

    assert response.status_code == 405
    assert response.headers["allow"] == "POST"


def test_an_unknown_method_is_a_json_rpc_error(server: TestClient) -> None:
    response = server.post("/mcp", json=_rpc("resources/list"), headers=MCP_HEADERS)

    assert response.status_code == 200
    assert response.json()["error"]["code"] == -32601


def test_a_body_that_is_not_json_is_a_parse_error(server: TestClient) -> None:
    response = server.post("/mcp", content=b"{nope", headers=MCP_HEADERS)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32700


def test_params_that_are_not_an_object_are_invalid(server: TestClient) -> None:
    response = server.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": [1]},
        headers=MCP_HEADERS,
    )

    assert response.json()["error"]["code"] == -32602 and response.json()["id"] == 4


def test_a_batch_is_answered_in_one_array_without_the_notifications(server: TestClient) -> None:
    response = server.post(
        "/mcp",
        json=[_rpc("ping", 7), {"jsonrpc": "2.0", "method": "notifications/initialized"}],
        headers=MCP_HEADERS,
    )

    assert response.json() == [{"jsonrpc": "2.0", "id": 7, "result": {}}]


def test_an_unknown_tool_is_a_protocol_error_and_a_failed_tool_is_a_result(
    server: TestClient,
) -> None:
    unknown = server.post("/mcp", json=_rpc("tools/call", name="arlesh_nope"), headers=MCP_HEADERS)
    failed = server.post(
        "/mcp",
        json=_rpc("tools/call", name="arlesh_tasks", arguments={"operation": "get", "id": "9999"}),
        headers=MCP_HEADERS,
    )

    assert unknown.status_code == 200 and unknown.json()["error"]["code"] == -32602
    assert failed.status_code == 200 and failed.json()["result"]["isError"] is True


def test_an_agents_write_is_journaled_under_its_tokens_client(
    server: TestClient, tokens: DatabaseTokenStore, server_db: Path, domain: int
) -> None:
    # Open the Domain to the MCP, as the app's MCP settings do: its roots are board rows.
    with sqlite3.connect(server_db) as connection:
        connection.execute(
            "INSERT INTO mcp_roots (node_kind, node_id) VALUES ('domain', ?)", (domain,)
        )
    headers = {**MCP_HEADERS, "Authorization": f"Bearer {tokens.add('agent-box')}"}
    revision = server.get("/health").headers["x-arlesh-revision"]

    response = server.post(
        "/mcp",
        json=_rpc(
            "tools/call",
            name="arlesh_tasks",
            arguments={
                "operation": "create",
                "title": "Filed by an agent",
                "parent_type": "domain",
                "parent_id": str(domain),
            },
        ),
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["result"].get("isError") is not True, response.text
    assert int(response.headers["x-arlesh-revision"]) > int(revision)
    with sqlite3.connect(server_db) as connection:
        writers = set(
            connection.execute(
                "SELECT source, client FROM undo_journal WHERE source = 'mcp'"
            ).fetchall()
        )
    assert writers == {("mcp", "agent-box")}
