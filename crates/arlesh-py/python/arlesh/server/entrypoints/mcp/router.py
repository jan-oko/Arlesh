"""``/mcp`` and ``/events/expectations``: the MCP entrypoint, served from this process.

``/mcp`` is Streamable HTTP with sessions: ``initialize`` opens one and answers its id in
``Mcp-Session-Id``, which the client sends with every later request; a POST carries one JSON-RPC
message and is answered with plain JSON, a message that wants no answer with ``202``. A request
with no session id is ``400``, one whose session this process does not know (it restarted, or
forgot it) is ``404`` and the client starts a new session, as the protocol says. There is no stream
for the server to speak first on, so ``GET`` answers ``405``; ``DELETE`` ends a session.

A session is **unattached** until its agent attaches with a one-time PIN, and then it is bound to
that agent: it sees only the agent's Claim. The connect token stands where the loopback-only
endpoint had its ``Host`` and ``Origin`` rules, and admits a session to attach and nothing more.

The protocol is :mod:`arlesh.server.entrypoints.mcp.jsonrpc`'s and the tools are the core's, run on
the write-open of one client for all agents (:data:`MCP_CLIENT`).
"""

from __future__ import annotations

import asyncio
import json
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from loguru import logger

import arlesh
from arlesh.server.business_logic.board import Board
from arlesh.server.entrypoints.fastapi.shutdown import going_down
from arlesh.server.entrypoints.mcp import jsonrpc

SESSION_HEADER = "Mcp-Session-Id"

SHUTDOWN_POLL_SECONDS = 0.5
"""How often a waiting long poll looks up to see whether the server is going down."""

_NO_STORE = {"Cache-Control": "no-store"}


class McpRouter(APIRouter):
    """``POST /mcp``: JSON-RPC in, JSON out."""

    def __init__(self, board: Board, client: str, **kwargs: Any) -> None:
        super().__init__(include_in_schema=False, **kwargs)
        self._board = board
        self._client = client
        self.post("")(self._post)
        self.delete("")(self._delete)
        self.get("")(self._not_allowed)

    async def _not_allowed(self) -> Response:
        return Response(status_code=405, headers={"Allow": "POST, DELETE"})

    async def _delete(self, request: Request) -> Response:
        """Ends a session."""
        database = await self._board.writer(self._client)
        session = request.headers.get(SESSION_HEADER)
        if session is None or not database.mcp_close_session(session):
            return Response(status_code=404)
        return Response(status_code=204)

    async def _post(self, request: Request) -> Response:
        try:
            body = json.loads(await request.body())
        except ValueError:
            unreadable = jsonrpc.error_reply(None, jsonrpc.PARSE_ERROR, "the body is not JSON")
            return JSONResponse(unreadable, status_code=400)
        database = await self._board.writer(self._client)
        version = request.headers.get("mcp-protocol-version")
        opening = _opens_a_session(body)
        session = request.headers.get(SESSION_HEADER)
        if opening:
            session = database.mcp_open_session()
        elif session is None:
            missing = jsonrpc.error_reply(
                None, jsonrpc.INVALID_REQUEST, f"{SESSION_HEADER} is required"
            )
            return JSONResponse(missing, status_code=400)
        elif not database.mcp_has_session(session):
            return Response(status_code=404)
        headers = {SESSION_HEADER: session} if opening and session else None
        if isinstance(body, list):
            return await _batch(database, body, version, session)
        reply = await _guarded(database, body, version, session)
        if reply is None:
            return Response(status_code=202)
        return JSONResponse(reply, headers=headers)


def _opens_a_session(body: object) -> bool:
    """Whether the request is the ``initialize`` that opens a session."""
    return isinstance(body, dict) and body.get("method") == "initialize"


async def _guarded(
    database: arlesh.Database, message: object, version: str | None, session: str | None
) -> jsonrpc.JSON | None:
    """The answer to ``message``, with anything unexpected made a JSON-RPC internal error."""
    try:
        return await jsonrpc.handle(database, message, version, session)
    except Exception:
        logger.exception("An MCP request failed")
        request_id = message.get("id") if isinstance(message, dict) else None
        return jsonrpc.error_reply(request_id, jsonrpc.INTERNAL_ERROR, "internal error")


async def _batch(
    database: arlesh.Database, messages: list[Any], version: str | None, session: str | None
) -> Response:
    if not messages:
        empty = jsonrpc.error_reply(None, jsonrpc.INVALID_REQUEST, "an empty batch")
        return JSONResponse(empty, status_code=400)
    replies = [
        reply
        for message in messages
        if (reply := await _guarded(database, message, version, session))
    ]
    return JSONResponse(replies) if replies else Response(status_code=202)


class ExpectationsRouter(APIRouter):
    """``GET /events/expectations``: the long poll over changes to the agents' waits."""

    def __init__(self, board: Board, **kwargs: Any) -> None:
        super().__init__(**kwargs)
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
