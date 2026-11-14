"""The JSON-RPC layer: what is a request, what is not answered, and that the core's words are only
put in an envelope."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, create_autospec

import arlesh
import pytest
from arlesh.server.entrypoints.mcp import jsonrpc


def _database() -> Any:
    database: Any = create_autospec(arlesh.Database, instance=True)
    database.mcp_call = AsyncMock(return_value={"result": {"content": []}})
    database.mcp_initialize = AsyncMock(return_value={"result": {"protocolVersion": "x"}})
    database.mcp_tools.return_value = [{"name": "arlesh_snapshot"}]
    return database


async def test_a_tool_call_is_the_cores_answer_in_the_requests_envelope() -> None:
    database = _database()

    reply = await jsonrpc.handle(
        database,
        {
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {"name": "arlesh_snapshot", "arguments": {"a": 1}},
        },
    )

    assert reply == {"jsonrpc": "2.0", "id": 5, "result": {"content": []}}
    database.mcp_call.assert_awaited_once_with("arlesh_snapshot", {"a": 1}, None, None)


async def test_a_call_with_no_arguments_passes_none() -> None:
    database = _database()

    await jsonrpc.handle(
        database, {"id": 1, "method": "tools/call", "params": {"name": "arlesh_snapshot"}}
    )

    database.mcp_call.assert_awaited_once_with("arlesh_snapshot", None, None, None)


@pytest.mark.parametrize(
    "params",
    [{}, {"name": 3}, {"name": "t", "arguments": [1]}],
    ids=["no name", "name not a string", "arguments not an object"],
)
async def test_a_call_with_malformed_params_is_invalid_params(params: dict[str, Any]) -> None:
    database = _database()

    reply = await jsonrpc.handle(database, {"id": 1, "method": "tools/call", "params": params})

    assert reply is not None and reply["error"]["code"] == jsonrpc.INVALID_PARAMS
    database.mcp_call.assert_not_awaited()


async def test_a_notification_and_a_response_are_not_answered() -> None:
    database = _database()

    note = await jsonrpc.handle(database, {"method": "notifications/initialized"})
    response = await jsonrpc.handle(database, {"id": 1, "result": {}})

    assert note is None and response is None


@pytest.mark.parametrize("message", [3, "ping", None, [1]])
async def test_a_message_that_is_not_an_object_is_an_invalid_request(message: object) -> None:
    reply = await jsonrpc.handle(_database(), message)

    assert reply is not None and reply["error"]["code"] == jsonrpc.INVALID_REQUEST


async def test_the_core_refusing_is_an_internal_error_not_a_crash() -> None:
    database = _database()
    database.mcp_call.side_effect = arlesh.InvalidRequest("boom")

    reply = await jsonrpc.handle(
        database, {"id": 9, "method": "tools/call", "params": {"name": "t"}}
    )

    assert reply is not None
    assert reply["id"] == 9 and reply["error"]["code"] == jsonrpc.INTERNAL_ERROR


async def test_initialize_and_tools_list_come_from_the_core() -> None:
    database = _database()

    initialised = await jsonrpc.handle(
        database, {"id": 1, "method": "initialize", "params": {"protocolVersion": "x"}}
    )
    listed = await jsonrpc.handle(database, {"id": 2, "method": "tools/list"})

    assert initialised == {"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "x"}}
    assert listed == {"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "arlesh_snapshot"}]}}


async def test_the_clients_protocol_version_goes_to_the_core() -> None:
    database = _database()

    await jsonrpc.handle(
        database, {"id": 1, "method": "tools/call", "params": {"name": "t"}}, "2025-06-18"
    )

    database.mcp_call.assert_awaited_once_with("t", None, "2025-06-18", None)
