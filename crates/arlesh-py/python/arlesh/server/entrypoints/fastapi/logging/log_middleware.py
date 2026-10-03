"""Every request logged twice — started and finished — under a transaction id."""

from __future__ import annotations

import time
import uuid

from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Stamps each request with a transaction id, and logs its start and its outcome."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        transaction_id = str(uuid.uuid4())
        request.state.transaction_id = transaction_id
        log = logger.bind(
            transaction_id=transaction_id, method=request.method, path=request.url.path
        )
        log.debug("Request started")
        started = time.perf_counter()
        response = await call_next(request)
        log.info(
            "Request completed",
            status_code=response.status_code,
            seconds=round(time.perf_counter() - started, 4),
        )
        return response
