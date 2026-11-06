"""``/mcp`` and ``/events/expectations``: the MCP entrypoint, served from this process.

``/mcp`` is Streamable HTTP without sessions: a POST carries one JSON-RPC message (or a batch)
and is answered with plain JSON, a message that wants no answer with ``202``. There is no stream
for the server to speak first on, so ``GET`` answers ``405``, as ``DELETE`` does (nothing to end),
and no session id is issued or required. The bearer token stands where the loopback-only endpoint
had its ``Host`` and ``Origin`` rules.

The protocol is :mod:`arlesh.server.entrypoints.mcp.jsonrpc`'s and the tools are the core's, run
on the write-open of the client the token names, so an agent's writes carry that client in the
undo journal.
"""

from __future__ import annotations

import asyncio
import json
from contextvars import ContextVar
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from loguru import logger

import arlesh
from arlesh.server.business_logic.board import Board
from arlesh.server.entrypoints.fastapi.shutdown import going_down
from arlesh.server.entrypoints.mcp import jsonrpc

SHUTDOWN_POLL_SECONDS = 0.5
"""How often a waiting long poll looks up to see whether the server is going down."""

_NO_STORE = {"Cache-Control": "no-store"}


class McpRouter(APIRouter):
    """``POST /mcp``: JSON-RPC in, JSON out."""

    def __init__(self, board: Board, client_context: ContextVar[str]) -> None:
        super().__init__(include_in_schema=False)
        self._board = board
        self._client_context = client_context
        self.post("")(self._post)
        self.api_route("", methods=["GET", "DELETE"])(self._not_allowed)

    async def _not_allowed(self) -> Response:
        return Response(status_code=405, headers={"Allow": "POST"})

    async def _post(self, request: Request) -> Response:
        try:
            body = json.loads(await request.body())
        except ValueError:
            unreadable = jsonrpc.error_reply(None, jsonrpc.PARSE_ERROR, "the body is not JSON")
            return JSONResponse(unreadable, status_code=400)
        database = await self._board.writer(self._client_context.get())
        version = request.headers.get("mcp-protocol-version")
        if isinstance(body, list):
            return await _batch(database, body, version)
        reply = await _guarded(database, body, version)
        return Response(status_code=202) if reply is None else JSONResponse(reply)


async def _guarded(
    database: arlesh.Database, message: object, version: str | None
) -> jsonrpc.JSON | None:
    """The answer to ``message``, with anything unexpected made a JSON-RPC internal error."""
    try:
        return await jsonrpc.handle(database, message, version)
    except Exception:
        logger.exception("An MCP request failed")
        request_id = message.get("id") if isinstance(message, dict) else None
        return jsonrpc.error_reply(request_id, jsonrpc.INTERNAL_ERROR, "internal error")


async def _batch(database: arlesh.Database, messages: list[Any], version: str | None) -> Response:
    if not messages:
        empty = jsonrpc.error_reply(None, jsonrpc.INVALID_REQUEST, "an empty batch")
        return JSONResponse(empty, status_code=400)
    replies = [
        reply for message in messages if (reply := await _guarded(database, message, version))
    ]
    return JSONResponse(replies) if replies else Response(status_code=202)


class ExpectationsRouter(APIRouter):
    """``GET /events/expectations``: the long poll over changes to the agents' waits."""

    def __init__(self, board: Board) -> None:
        super().__init__()
        self._board = board
        self.get("")(self._poll)

    async def _poll(
        self,
        agentic: bool = False,
        after: Annotated[int | None, Query(ge=0)] = None,
        epoch: str | None = None,
        wait: Annotated[int | None, Query(ge=0)] = None,
    ) -> Response:
        """The changes to the waits the MCP can see, as one JSON answer
        ``{revision, epoch, changes}``: each change is a wait released, reopened, archived,
        unarchived, deleted or created, with its ids, its Task's, its status, whether it is
        archived or deleted, and the revision it was noticed at. ``agentic=true`` keeps only the
        waits an agent raised. An edit to a pending wait's title or note is no change.

        It answers as soon as a change past ``after`` (the revision heard up to, from the last
        answer) exists, or empty once ``wait`` seconds (25 by default, 30 at most) have passed;
        poll again with the ``revision`` it gave. ``{..., changes: [], reset: true}`` means there
        is no cursor to resume from (none, another run's ``epoch``, or one too old): read the
        waits (``arlesh_waits.get_many``), then poll from ``revision``. ``wait=0`` answers
        without waiting. No history is kept beyond a short log."""
        polling = asyncio.ensure_future(
            self._board.reader.expectations_poll(
                agentic=agentic, after=after, epoch=epoch, wait=wait
            )
        )
        try:
            while not polling.done():
                if going_down():
                    raise HTTPException(status_code=503, detail="the server is shutting down")
                await asyncio.wait({polling}, timeout=SHUTDOWN_POLL_SECONDS)
            return JSONResponse(polling.result(), headers=_NO_STORE)
        finally:
            polling.cancel()
