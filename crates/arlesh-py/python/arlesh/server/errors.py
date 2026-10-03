"""Failures as HTTP: the ``WireError`` kind always in the body, and a status chosen by kind.

A client branches on ``kind``; the status is a courtesy for generic HTTP tooling. Every response
that is not a success carries an :class:`ErrorBody` — the core's refusals, a request that does not
parse, a route that does not exist and an unexpected crash alike.
"""

from __future__ import annotations

import logging
from typing import Any

from arlesh import ArleshError
from arlesh.models import WireErrorKind
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException

log = logging.getLogger(__name__)


class ErrorBody(BaseModel):
    """A refused or failed request: the core's ``WireError``, as it crosses HTTP."""

    kind: WireErrorKind
    """What went wrong, as the core classifies it. Branch on this, not on the status."""
    message: str
    """A human-readable account. Not for parsing."""
    details: Any = None
    """Structured context, when the kind has any: what a confirmation is about, why an open was
    refused (``details.reason``), the validation errors of a malformed request."""


STATUS_BY_KIND: dict[WireErrorKind, int] = {
    WireErrorKind.not_found: 404,
    WireErrorKind.invalid_request: 400,
    WireErrorKind.ambiguous_id: 400,
    WireErrorKind.containment_violated: 409,
    WireErrorKind.status_changed: 409,
    WireErrorKind.needs_confirmation: 422,
    WireErrorKind.needs_time_scope: 422,
    WireErrorKind.not_permitted: 403,
    WireErrorKind.database: 500,
    WireErrorKind.internal: 500,
}
"""The status each kind is answered with. ``needs_confirmation`` and ``needs_time_scope`` share
422: the request was understood, and the answer is the same request again with more in it."""

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    status: {"model": ErrorBody, "description": description}
    for status, description in (
        (400, "invalid_request or ambiguous_id; also a missing X-Arlesh-Client on a write"),
        (403, "not_permitted: e.g. a write-open refused while the desktop app holds the database"),
        (404, "not_found"),
        (409, "containment_violated or status_changed"),
        (422, "needs_confirmation or needs_time_scope: send it again with more"),
        (500, "database or internal"),
    )
}
"""The error responses every route declares, so the OpenAPI schema names the body."""


def _answer(status: int, kind: WireErrorKind, message: str, details: Any = None) -> JSONResponse:
    body = ErrorBody(kind=kind, message=message, details=details)
    return JSONResponse(status_code=status, content=jsonable_encoder(body))


def _kind_of(error: ArleshError) -> WireErrorKind:
    """The error's kind; one this build does not know is reported as ``internal``."""
    try:
        return WireErrorKind(error.kind)
    except ValueError:
        return WireErrorKind.internal


async def _core_refusal(_request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, ArleshError):
        return await _crash(_request, error)
    kind = _kind_of(error)
    status = STATUS_BY_KIND[kind]
    if status >= 500:
        log.error("core failure", extra={"kind": error.kind, "error_message": error.message})
    return _answer(status, kind, error.message, error.details)


async def _malformed(_request: Request, error: Exception) -> JSONResponse:
    errors = error.errors() if isinstance(error, RequestValidationError) else []
    return _answer(
        400,
        WireErrorKind.invalid_request,
        "the request does not match its schema",
        {"reason": "validation", "errors": jsonable_encoder(errors)},
    )


async def _http(_request: Request, error: Exception) -> JSONResponse:
    status = error.status_code if isinstance(error, HTTPException) else 500
    detail = error.detail if isinstance(error, HTTPException) else str(error)
    kind = WireErrorKind.not_found if status == 404 else WireErrorKind.invalid_request
    return _answer(status, kind, str(detail))


async def _crash(_request: Request, error: Exception) -> JSONResponse:
    log.exception("unexpected failure", exc_info=error)
    return _answer(500, WireErrorKind.internal, "an unexpected error occurred")


def install(app: FastAPI) -> None:
    """Answers every failure on ``app`` with an :class:`ErrorBody`."""
    app.add_exception_handler(ArleshError, _core_refusal)
    app.add_exception_handler(RequestValidationError, _malformed)
    app.add_exception_handler(HTTPException, _http)
    app.add_exception_handler(Exception, _crash)
