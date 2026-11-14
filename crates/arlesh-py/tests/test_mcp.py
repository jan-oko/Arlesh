"""Serving the MCP endpoint from Python: loopback only, write-opens only, and it answers."""

from __future__ import annotations

import asyncio
import json
import urllib.request
from pathlib import Path
from typing import Any

import arlesh
import pytest

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


def post_initialize(port: int) -> tuple[int, str]:
    """POSTs an MCP ``initialize`` to the endpoint on ``port``, and answers status and body."""
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/mcp",
        data=json.dumps(INITIALIZE).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, response.read(4096).decode()


async def test_the_served_endpoint_answers_initialize(db: arlesh.Database) -> None:
    port = await db.serve_mcp()
    assert port > 0
    status, body = await asyncio.to_thread(post_initialize, port)
    assert status == 200
    assert '"serverInfo"' in body
    await db.stop_mcp()
    with pytest.raises(OSError):
        await asyncio.to_thread(post_initialize, port)


async def test_a_second_serve_on_one_database_is_refused(db: arlesh.Database) -> None:
    await db.serve_mcp()
    with pytest.raises(arlesh.InvalidRequest) as refusal:
        await db.serve_mcp()
    assert refusal.value.details == {"reason": "already_serving"}


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.1.10", "localhost", "example.com"])
async def test_only_a_loopback_address_is_served(db: arlesh.Database, host: str) -> None:
    with pytest.raises(arlesh.InvalidRequest) as refusal:
        await db.serve_mcp(host=host)
    assert refusal.value.details == {"reason": "not_loopback"}


async def test_a_read_only_database_does_not_serve_it(
    db: arlesh.Database, database_path: Path
) -> None:
    async with await arlesh.open(database_path) as reader:
        with pytest.raises(arlesh.InvalidRequest) as refusal:
            await reader.serve_mcp()
    assert refusal.value.details == {"reason": "read_only"}


async def test_stopping_when_nothing_is_served_does_nothing(db: arlesh.Database) -> None:
    await db.stop_mcp()


# ---- The MCP the Python server speaks itself must answer as the Rust endpoint does ----------


class Connected:
    """A client of the Rust endpoint (the one a desktop app serves), over a session."""

    def __init__(self, port: int) -> None:
        self._url = f"http://127.0.0.1:{port}/mcp"
        self._session: str | None = None
        self._next = 10

    def _send(self, message: dict[str, Any]) -> tuple[int, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self._session is not None:
            headers["Mcp-Session-Id"] = self._session
        request = urllib.request.Request(
            self._url, data=json.dumps(message).encode(), headers=headers, method="POST"
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            self._session = response.headers.get("Mcp-Session-Id", self._session)
            return response.status, response.read().decode()

    def ask(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """The JSON-RPC answer to a request: its ``result`` or ``error`` member."""
        self._next += 1
        _, body = self._send(
            {"jsonrpc": "2.0", "id": self._next, "method": method, "params": params}
        )
        data = [
            line[5:] for line in body.splitlines() if line.startswith("data:") and line[5:].strip()
        ]
        answer: dict[str, Any] = json.loads(data[-1] if data else body)
        return {key: answer[key] for key in ("result", "error") if key in answer}

    def start(self) -> dict[str, Any]:
        """Initialises the session, answering the handshake."""
        answer = self.ask("initialize", INITIALIZE["params"])  # type: ignore[arg-type]
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return answer


async def _both(db: arlesh.Database) -> Connected:
    client = Connected(await db.serve_mcp())
    await asyncio.to_thread(client.start)
    return client


async def test_the_handshake_is_the_rust_endpoints(db: arlesh.Database) -> None:
    client = Connected(await db.serve_mcp())

    rust = await asyncio.to_thread(client.start)
    python = await db.mcp_initialize(INITIALIZE["params"])  # type: ignore[arg-type]

    assert python == rust
    assert "arlesh_snapshot" in python["result"]["instructions"]
    assert python["result"]["instructions"] == await db.mcp_instructions()


async def test_the_tool_list_is_the_rust_endpoints(db: arlesh.Database) -> None:
    client = await _both(db)

    rust = await asyncio.to_thread(client.ask, "tools/list", {})

    assert db.mcp_tools() == rust["result"]["tools"]


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [
        ("arlesh_missing", {}),
        ("arlesh_tasks", {"operation": "get", "id": "999999"}),
        ("arlesh_tasks", {"operation": "get"}),
        ("arlesh_tasks", {"operation": 7}),
        ("arlesh_waits", {"operation": "release", "id": "nope"}),
        ("arlesh_agents", {"operation": "status"}),
        ("arlesh_snapshot", None),
    ],
    ids=[
        "unknown tool",
        "no such task",
        "missing id",
        "wrong type",
        "bad wait",
        "bad flag",
        "bare",
    ],
)
async def test_a_call_is_answered_as_the_rust_endpoint_answers_it(
    db: arlesh.Database, tool: str, arguments: dict[str, Any] | None
) -> None:
    client = await _both(db)

    rust = await asyncio.to_thread(
        client.ask,
        "tools/call",
        {"name": tool, **({} if arguments is None else {"arguments": arguments})},
    )
    python = await db.mcp_call(tool, arguments, "2025-03-26")

    assert python == rust


async def test_an_unknown_tool_is_a_protocol_error_and_a_failed_tool_is_a_result(
    db: arlesh.Database,
) -> None:
    unknown = await db.mcp_call("arlesh_missing", {})
    failed = await db.mcp_call("arlesh_tasks", {"operation": "get", "id": "999999"})

    assert unknown["error"]["code"] == -32602
    assert failed["result"]["isError"] is True


async def test_a_read_only_database_does_not_answer_the_mcp(
    db: arlesh.Database, database_path: Path
) -> None:
    async with await arlesh.open(database_path) as reader:
        with pytest.raises(arlesh.InvalidRequest):
            await reader.mcp_call("arlesh_snapshot", None)
        with pytest.raises(arlesh.InvalidRequest):
            reader.mcp_tools()
