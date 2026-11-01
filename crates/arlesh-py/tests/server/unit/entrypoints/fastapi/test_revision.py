"""The revision stamp and the gzip around the app, over a bare ASGI app."""

from __future__ import annotations

import warnings

from arlesh.server.business_logic.board import BoardNotOpen
from arlesh.server.entrypoints.fastapi.revision import (
    EPOCH_HEADER,
    REVISION_HEADER,
    GzipExceptEventsMiddleware,
    RevisionHeadersMiddleware,
)
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response
from starlette.routing import Route

with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    from starlette.testclient import TestClient

BIG = "x" * 5000


class Counter:
    """A revision that a write moves."""

    def __init__(self) -> None:
        self.revision = 0


def _app(counter: Counter) -> Starlette:
    async def read(_: Request) -> Response:
        # A write that lands while the read runs.
        counter.revision += 1
        return PlainTextResponse("read")

    async def write(_: Request) -> Response:
        counter.revision += 1
        return PlainTextResponse("written")

    async def big(_: Request) -> Response:
        return PlainTextResponse(BIG)

    return Starlette(
        routes=[
            Route("/read", read),
            Route("/write", write, methods=["POST"]),
            Route("/big", big),
            Route("/events", big),
        ]
    )


def _stamped(counter: Counter) -> TestClient:
    app = RevisionHeadersMiddleware(_app(counter), revision=lambda: counter.revision, epoch="run1")
    return TestClient(app)


def test_a_read_carries_the_revision_it_arrived_at() -> None:
    counter = Counter()
    response = _stamped(counter).get("/read")

    assert response.headers[REVISION_HEADER] == "0"
    assert response.headers[EPOCH_HEADER] == "run1"
    assert counter.revision == 1


def test_a_write_carries_the_revision_it_committed() -> None:
    counter = Counter()
    response = _stamped(counter).post("/write")

    assert response.headers[REVISION_HEADER] == "1"


def test_an_answer_before_the_board_is_open_carries_no_stamp() -> None:
    def closed() -> int:
        raise BoardNotOpen("the board is not open")

    client = TestClient(RevisionHeadersMiddleware(_app(Counter()), revision=closed, epoch="run1"))
    response = client.get("/read")

    assert response.status_code == 200
    assert REVISION_HEADER not in response.headers


def test_a_big_answer_is_gzipped_when_the_client_accepts_it() -> None:
    client = TestClient(GzipExceptEventsMiddleware(_app(Counter())))

    response = client.get("/big", headers={"Accept-Encoding": "gzip"})

    assert response.headers["content-encoding"] == "gzip"
    assert response.text == BIG


def test_the_change_stream_is_never_gzipped() -> None:
    client = TestClient(GzipExceptEventsMiddleware(_app(Counter())))

    response = client.get("/events", headers={"Accept-Encoding": "gzip"})

    assert "content-encoding" not in response.headers
    assert response.text == BIG
