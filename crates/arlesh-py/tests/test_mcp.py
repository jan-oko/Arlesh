"""Serving the MCP endpoint from Python: loopback only, write-opens only, and it answers."""

from __future__ import annotations

import asyncio
import json
import urllib.request
from pathlib import Path

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
