"""Failures as HTTP: the ``WireError`` kind always in the body, and a status chosen by kind.

A client branches on ``kind``; the status serves generic HTTP tooling. Every response that is not
a success carries an :class:`ErrorBody` — the core's refusals, a missing token, a request that
does not parse, a route that does not exist and an unexpected crash alike.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from loguru import logger
from starlette.exceptions import HTTPException

from arlesh import ArleshError
from arlesh.models import WireErrorKind
from arlesh.server.business_logic.pairing import PairingRefused
from arlesh.server.entrypoints.fastapi.exceptions import AuthenticationFailed, RateLimited
from arlesh.server.entrypoints.fastapi.models import ErrorBody

STATUS_BY_KIND: dict[WireErrorKind, int] = {
    WireErrorKind.not_found: status.HTTP_404_NOT_FOUND,
    WireErrorKind.invalid_request: status.HTTP_400_BAD_REQUEST,
    WireErrorKind.ambiguous_id: status.HTTP_400_BAD_REQUEST,
    WireErrorKind.containment_violated: status.HTTP_409_CONFLICT,
    WireErrorKind.status_changed: status.HTTP_409_CONFLICT,
    WireErrorKind.needs_confirmation: status.HTTP_422_UNPROCESSABLE_CONTENT,
    WireErrorKind.needs_time_scope: status.HTTP_422_UNPROCESSABLE_CONTENT,
    WireErrorKind.not_permitted: status.HTTP_403_FORBIDDEN,
    WireErrorKind.database: status.HTTP_500_INTERNAL_SERVER_ERROR,
    WireErrorKind.internal: status.HTTP_500_INTERNAL_SERVER_ERROR,
}
"""The status each core kind is answered with. ``needs_confirmation`` and ``needs_time_scope``
share 422: the request was understood, and the answer is the same request again with more."""

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorBody, "description": description}
    for code, description in (
        (400, "invalid_request or ambiguous_id"),
        (401, "not_permitted: no bearer token, or one this server did not issue"),
        (403, "not_permitted: the core refused what the request names"),
        (404, "not_found"),
        (409, "containment_violated or status_changed"),
        (422, "needs_confirmation or needs_time_scope: send it again with more"),
        (429, "not_permitted: too many pairing requests, or too many devices waiting"),
        (500, "database or internal"),
    )
}
"""The error responses every route declares, so the OpenAPI schema names the body."""


def _transaction_id(request: Request) -> str | None:
    return getattr(request.state, "transaction_id", None)


def _answer(
    request: Request,
    code: int,
    kind: WireErrorKind,
    message: str,
    details: Any = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    transaction_id = _transaction_id(request)
    if code >= 500:
        logger.error("Answered a server (5xx) error", kind=kind, transaction_id=transaction_id)
    else:
        logger.warning("Answered a client (4xx) error", kind=kind, transaction_id=transaction_id)
    body = ErrorBody(
        kind=kind,
        message=message,
        details=details,
        transaction_id=transaction_id if code >= 500 else None,
    )
    return JSONResponse(status_code=code, content=jsonable_encoder(body), headers=headers)


def _kind_of(error: ArleshError) -> WireErrorKind:
    """The error's kind; one this build does not know is reported as ``internal``."""
    try:
        return WireErrorKind(error.kind)
    except ValueError:
        return WireErrorKind.internal


async def handle_core_refusal(request: Request, exc: Exception) -> JSONResponse:
    """The core refused or failed: its kind, message and details, at the kind's status."""
    if not isinstance(exc, ArleshError):
        return await handle_unknown_exception(request, exc)
    kind = _kind_of(exc)
    return _answer(request, STATUS_BY_KIND[kind], kind, exc.message, exc.details)


async def handle_authentication_failure(request: Request, exc: Exception) -> JSONResponse:
    """No token, or one nobody holds: 401, naming the scheme."""
    reason = exc.reason if isinstance(exc, AuthenticationFailed) else "unauthenticated"
    return _answer(
        request,
        status.HTTP_401_UNAUTHORIZED,
        WireErrorKind.not_permitted,
        str(exc),
        {"reason": reason},
        headers={"WWW-Authenticate": "Bearer"},
    )


_PAIRING_STATUS: dict[str, tuple[int, WireErrorKind]] = {
    "unknown_pairing": (status.HTTP_404_NOT_FOUND, WireErrorKind.not_found),
    "unknown_pin": (status.HTTP_404_NOT_FOUND, WireErrorKind.not_found),
    "unknown_device": (status.HTTP_404_NOT_FOUND, WireErrorKind.not_found),
    "wrong_pin": (status.HTTP_403_FORBIDDEN, WireErrorKind.not_permitted),
    "pin_invalidated": (status.HTTP_403_FORBIDDEN, WireErrorKind.not_permitted),
    "current_device": (status.HTTP_403_FORBIDDEN, WireErrorKind.not_permitted),
    "too_many_pending": (status.HTTP_429_TOO_MANY_REQUESTS, WireErrorKind.not_permitted),
    "name_taken": (status.HTTP_409_CONFLICT, WireErrorKind.status_changed),
}
"""Each pairing refusal's status and kind. The body's ``details.reason`` is the refusal's word."""


async def handle_pairing_refusal(request: Request, exc: Exception) -> JSONResponse:
    """A pairing rule refused: its reason in ``details``, at the status the reason names."""
    if not isinstance(exc, PairingRefused):
        return await handle_unknown_exception(request, exc)
    code, kind = _PAIRING_STATUS.get(
        exc.reason, (status.HTTP_400_BAD_REQUEST, WireErrorKind.invalid_request)
    )
    return _answer(request, code, kind, str(exc), {"reason": exc.reason, **exc.details})


async def handle_rate_limit(request: Request, exc: Exception) -> JSONResponse:
    """Too many requests from one address: 429 ``not_permitted``, saying when to retry."""
    retry_after = exc.retry_after if isinstance(exc, RateLimited) else 60
    return _answer(
        request,
        status.HTTP_429_TOO_MANY_REQUESTS,
        WireErrorKind.not_permitted,
        str(exc),
        {"reason": "rate_limited", "retry_after": retry_after},
        headers={"Retry-After": str(retry_after)},
    )


async def handle_request_validation_exception(request: Request, exc: Exception) -> JSONResponse:
    """A request that does not match its schema: 400 ``invalid_request``, naming the fields."""
    errors = exc.errors() if isinstance(exc, RequestValidationError) else []
    return _answer(
        request,
        status.HTTP_400_BAD_REQUEST,
        WireErrorKind.invalid_request,
        "the request does not match its schema",
        {"reason": "validation", "errors": jsonable_encoder(errors)},
    )


async def handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    """Routing's own refusals: an unknown route is ``not_found`` with ``details.reason =
    "unknown_route"`` — so a newer app can tell a feature this server lacks from a node that does
    not exist — and a wrong method ``invalid_request``."""
    code = exc.status_code if isinstance(exc, HTTPException) else 500
    detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
    if code == 404:
        return _answer(
            request, code, WireErrorKind.not_found, str(detail), {"reason": "unknown_route"}
        )
    return _answer(request, code, WireErrorKind.invalid_request, str(detail))


async def handle_unknown_exception(request: Request, exc: Exception) -> JSONResponse:
    """Anything else: 500 ``internal``, logged with its trace, which the body never carries."""
    logger.opt(exception=exc).error("Encountered an unknown exception")
    return _answer(
        request,
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        WireErrorKind.internal,
        "an unexpected error occurred",
    )
