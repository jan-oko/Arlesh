"""``/mcp``: Arlesh's MCP endpoint through the server, behind the token."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from arlesh.server.ports.tokens.file_token_store import FileTokenStore
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
MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Origin": "http://evil.example"}


def _message(body: str) -> dict[str, Any]:
    """The JSON-RPC message in a response: plain JSON, or the data of an SSE event."""
    for line in body.splitlines():
        if line.startswith("data:") and line[5:].strip():
            parsed: dict[str, Any] = json.loads(line[5:])
            return parsed
    loaded: dict[str, Any] = json.loads(body)
    return loaded


def _session(server: TestClient, headers: dict[str, str] | None = None) -> str:
    response = server.post("/mcp", json=INITIALIZE, headers={**MCP_HEADERS, **(headers or {})})
    assert response.status_code == 200, response.text
    session: str = response.headers["mcp-session-id"]
    server.post(
        "/mcp",
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={**MCP_HEADERS, "mcp-session-id": session, **(headers or {})},
    )
    return session


def test_an_authorised_initialize_answers_with_the_servers_info(server: TestClient) -> None:
    response = server.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS)

    assert response.status_code == 200, response.text
    assert response.headers["mcp-session-id"]
    assert "serverInfo" in _message(response.text)["result"]


def test_an_unauthorised_initialize_is_401(server: TestClient) -> None:
    del server.headers["Authorization"]

    response = server.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS)

    assert response.status_code == 401
    assert response.json()["kind"] == "not_permitted"


def test_a_session_lists_tools_and_ends(server: TestClient) -> None:
    session = _session(server)
    headers = {**MCP_HEADERS, "mcp-session-id": session}

    tools = server.post(
        "/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, headers=headers
    )
    ended = server.delete("/mcp", headers=headers)

    assert tools.status_code == 200, tools.text
    names = [tool["name"] for tool in _message(tools.text)["result"]["tools"]]
    assert "arlesh_snapshot" in names
    assert ended.status_code < 300


def test_an_agents_write_is_journaled_under_its_tokens_client(
    server: TestClient, tokens: FileTokenStore, server_db: Path, domain: int
) -> None:
    # Open the Domain to the MCP, as the app's MCP settings do: its roots are board rows.
    with sqlite3.connect(server_db) as connection:
        connection.execute(
            "INSERT INTO mcp_roots (node_kind, node_id) VALUES ('domain', ?)", (domain,)
        )
    headers = {"Authorization": f"Bearer {tokens.add('agent-box')}"}
    session = _session(server, headers)

    response = server.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "arlesh_tasks",
                "arguments": {
                    "operation": "create",
                    "title": "Filed by an agent",
                    "parent_type": "domain",
                    "parent_id": str(domain),
                },
            },
        },
        headers={**MCP_HEADERS, **headers, "mcp-session-id": session},
    )

    assert response.status_code == 200, response.text
    assert _message(response.text)["result"].get("isError") is not True, response.text
    with sqlite3.connect(server_db) as connection:
        writers = set(
            connection.execute(
                "SELECT source, client FROM undo_journal WHERE source = 'mcp'"
            ).fetchall()
        )
    assert writers == {("mcp", "agent-box")}
