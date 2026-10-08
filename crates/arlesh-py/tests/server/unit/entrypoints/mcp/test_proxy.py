"""The ``/mcp`` proxy: what it forwards, what it strips, and that it streams the answer back."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextvars import ContextVar

import httpx
from arlesh.server.entrypoints.fastapi.routers.mcp import McpRouter
from arlesh.server.ports.mcp.mcp_backend import McpBackend
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient


class FakeBackend(McpBackend):
    def __init__(self) -> None:
        self.asked: list[str] = []

    async def endpoint(self, client: str) -> str:
        self.asked.append(client)
        return "http://127.0.0.1:5000/mcp"


class Upstream(httpx.AsyncBaseTransport):
    """An upstream whose answers stream, as a real connection's do."""

    def __init__(self, answer: Callable[[httpx.Request], httpx.Response]) -> None:
        self._answer = answer

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        await request.aread()
        return self._answer(request)


def chunked(body: bytes) -> AsyncIterator[bytes]:
    async def chunks() -> AsyncIterator[bytes]:
        yield body

    return chunks()


def _proxy(upstream: Upstream, backend: FakeBackend) -> TestClient:
    context: ContextVar[str] = ContextVar("client")

    async def as_phone() -> None:
        context.set("phone")

    router = McpRouter(backend, context, http=httpx.AsyncClient(transport=upstream))
    app = FastAPI(dependencies=[Depends(as_phone)])
    app.include_router(router, prefix="/mcp")
    return TestClient(app)


def test_a_request_reaches_the_clients_endpoint_with_only_the_protocols_headers() -> None:
    seen: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            content=chunked(b"data: {}\n\n"),
            headers={"content-type": "text/event-stream", "mcp-session-id": "s1", "x-other": "1"},
        )

    backend = FakeBackend()
    with _proxy(Upstream(upstream), backend) as client:
        response = client.post(
            "/mcp?probe=1",
            content=b'{"jsonrpc":"2.0"}',
            headers={
                "Authorization": "Bearer secret",
                "Origin": "http://evil.example",
                "Referer": "http://evil.example/page",
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
                "mcp-session-id": "s1",
            },
        )

    forwarded = seen[0]
    assert backend.asked == ["phone"]
    assert str(forwarded.url) == "http://127.0.0.1:5000/mcp?probe=1"
    assert forwarded.headers["host"] == "127.0.0.1:5000"
    assert forwarded.headers["mcp-session-id"] == "s1"
    assert forwarded.headers["accept"] == "application/json, text/event-stream"
    assert forwarded.content == b'{"jsonrpc":"2.0"}'
    for stripped in ("authorization", "origin", "referer"):
        assert stripped not in forwarded.headers
    assert response.text == "data: {}\n\n"
    assert response.headers["mcp-session-id"] == "s1"
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "x-other" not in response.headers


def test_get_and_delete_pass_through_with_the_upstreams_status() -> None:
    methods: list[str] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        methods.append(request.method)
        return httpx.Response(405 if request.method == "GET" else 202, content=chunked(b""))

    with _proxy(Upstream(upstream), FakeBackend()) as client:
        streamed = client.get("/mcp")
        ended = client.delete("/mcp")

    assert methods == ["GET", "DELETE"]
    assert (streamed.status_code, ended.status_code) == (405, 202)
