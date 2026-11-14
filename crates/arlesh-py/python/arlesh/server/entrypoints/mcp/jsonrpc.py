"""The MCP protocol as JSON-RPC 2.0: which method a message is, and what answers it.

This module speaks the protocol and nothing else. Every answer of substance — the handshake, the
tool list, a tool's result or refusal — is the core's, got from the client's own write-open of the
database (:meth:`arlesh.Database.mcp_initialize` and its siblings); here it is only put in its
envelope, or a protocol error is made when no core answer exists (a message that is not a request,
an unknown method, params of the wrong shape).
"""

from __future__ import annotations

from typing import Any

from loguru import logger

import arlesh

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
"""The JSON-RPC 2.0 error codes the server makes itself. The core's own errors keep its codes."""

JSON = dict[str, Any]


def error_reply(request_id: object, code: int, message: str) -> JSON:
    """A JSON-RPC error answer."""
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _reply(request_id: object, outcome: JSON) -> JSON:
    """The core's ``{"result": ...}`` or ``{"error": ...}`` in the request's envelope."""
    return {"jsonrpc": "2.0", "id": request_id, **outcome}


async def handle(
    database: arlesh.Database,
    message: object,
    protocol_version: str | None = None,
    session_id: str | None = None,
) -> JSON | None:
    """The answer to one JSON-RPC ``message``, or ``None`` when it wants none.

    A notification (no ``id``) and a client's answer to a request of the server's are accepted and
    not answered. ``protocol_version`` is the client's ``MCP-Protocol-Version`` header, since no
    session remembers it. Never raises: a failure the core reports is a JSON-RPC internal error.
    """
    if not isinstance(message, dict):
        return error_reply(None, INVALID_REQUEST, "a JSON-RPC message is an object")
    method = message.get("method")
    if method is None:
        return None  # a response to a request of the server's; it makes none
    request_id = message.get("id")
    if not isinstance(method, str):
        return error_reply(request_id, INVALID_REQUEST, "method must be a string")
    if "id" not in message:
        return None  # a notification, such as notifications/initialized
    params = message.get("params")
    if params is not None and not isinstance(params, dict):
        return error_reply(request_id, INVALID_PARAMS, "params must be an object")
    try:
        return await _request(
            database, request_id, method, params or {}, protocol_version, session_id
        )
    except arlesh.ArleshError as failure:
        logger.warning("The core refused an MCP request", method=method, kind=failure.KIND)
        return error_reply(request_id, INTERNAL_ERROR, failure.message)


async def _request(
    database: arlesh.Database,
    request_id: object,
    method: str,
    params: JSON,
    protocol_version: str | None,
    session_id: str | None,
) -> JSON:
    if method == "initialize":
        return _reply(request_id, await database.mcp_initialize(params, session_id))
    if method == "ping":
        return _reply(request_id, {"result": {}})
    if method == "tools/list":
        return _reply(request_id, {"result": {"tools": database.mcp_tools()}})
    if method == "tools/call":
        return await _call(database, request_id, params, protocol_version, session_id)
    return error_reply(request_id, METHOD_NOT_FOUND, f"method not found: {method}")


async def _call(
    database: arlesh.Database,
    request_id: object,
    params: JSON,
    protocol_version: str | None,
    session_id: str | None,
) -> JSON:
    name = params.get("name")
    arguments = params.get("arguments")
    if not isinstance(name, str):
        return error_reply(request_id, INVALID_PARAMS, "name must be the tool's name")
    if arguments is not None and not isinstance(arguments, dict):
        return error_reply(request_id, INVALID_PARAMS, "arguments must be an object")
    return _reply(
        request_id, await database.mcp_call(name, arguments, protocol_version, session_id)
    )
