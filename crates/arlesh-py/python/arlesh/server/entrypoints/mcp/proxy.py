"""``/mcp``: the MCP entrypoint, a streaming reverse proxy to the client's own MCP endpoint.

The endpoint itself is the core's, served per client by the :class:`Board`; this router is the
way in to it, mounted on the FastAPI app behind the bearer token.

The upstream is the core's MCP router, which has no authentication of its own, admits a loopback
``Host`` only and refuses any request carrying an ``Origin``. So this proxy sits behind the bearer
token like every route, sends the upstream a loopback ``Host`` (httpx sets it from the URL), and
forwards only the headers the protocol needs — never ``Authorization``, ``Origin`` or
``Referer``. Responses stream through as they come, so Server-Sent Events arrive unbuffered.
"""

from __future__ import annotations

from collections.abc import Mapping
from contextvars import ContextVar

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from arlesh.server.business_logic.board import Board

REQUEST_HEADERS = (
    "accept",
    "content-type",
    "mcp-session-id",
    "mcp-protocol-version",
    "last-event-id",
)
"""What a client's request carries upstream."""

RESPONSE_HEADERS = (
    "content-type",
    "mcp-session-id",
    "mcp-protocol-version",
    "cache-control",
    "content-encoding",
)
"""What the upstream's answer carries back."""


class McpProxyRouter(APIRouter):
    """Proxies POST, GET (the event stream) and DELETE (ending a session) on ``/mcp``."""

    def __init__(
        self,
        board: Board,
        client_context: ContextVar[str],
        http: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(include_in_schema=False)
        self._board = board
        self._client_context = client_context
        # A read timeout would cut a long-lived event stream; connecting still times out.
        self._http = http or httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None))
        self.api_route("", methods=["GET", "POST", "DELETE"])(self._proxy)

    async def aclose(self) -> None:
        """Closes the connections to the upstream."""
        await self._http.aclose()

    async def _proxy(self, request: Request) -> StreamingResponse:
        upstream = await self._board.mcp_endpoint(self._client_context.get())
        return await self._forward(request, upstream)

    async def forward_beside(self, request: Request, path: str) -> StreamingResponse:
        """Proxies ``request`` to ``path`` on the origin of the client's MCP endpoint: the event
        streams the core serves beside ``/mcp``, on the same listener and so the same client."""
        upstream = await self._board.mcp_endpoint(self._client_context.get())
        return await self._forward(request, upstream.removesuffix("/mcp") + path)

    async def _forward(self, request: Request, upstream: str) -> StreamingResponse:
        forwarded = self._http.build_request(
            request.method,
            upstream,
            params=request.query_params,
            headers=_pick(request.headers, REQUEST_HEADERS),
            content=await request.body(),
        )
        answer = await self._http.send(forwarded, stream=True)
        return StreamingResponse(
            answer.aiter_raw(),
            status_code=answer.status_code,
            headers=_pick(answer.headers, RESPONSE_HEADERS),
            background=BackgroundTask(answer.aclose),
        )


class ExpectationsProxyRouter(APIRouter):
    """``GET /events/expectations``: the wait stream the core serves beside ``/mcp``.

    The core is the one place that knows how to read waits the way the MCP sees them, so this is
    a proxy to it, behind the bearer token, as ``/mcp`` is. ``?agentic=true`` goes through.
    """

    def __init__(self, mcp: McpProxyRouter) -> None:
        super().__init__()
        self._mcp = mcp
        self.get("", response_class=StreamingResponse)(self._stream)

    async def _stream(self, request: Request, agentic: bool = False) -> StreamingResponse:
        """``wait-changed`` for each change to a wait, as Server-Sent Events: its ids, the Task's,
        its status, whether it is archived or deleted, and the revision. ``agentic=true`` keeps
        only the waits an agent raised. No history is kept: read the waits you follow
        (``arlesh_waits.get_many``) after you connect."""
        del agentic  # forwarded with the rest of the query string
        return await self._mcp.forward_beside(request, "/events/expectations")


def _pick(headers: Mapping[str, str], names: tuple[str, ...]) -> dict[str, str]:
    return {name: value for name in names if (value := headers.get(name)) is not None}
