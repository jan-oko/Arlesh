"""The exceptions a call raises: one class per ``WireError`` kind, under ``ArleshError``.

The core classifies every failure with a stable kind — the same one the desktop frontend and the
MCP's clients branch on — so a caller catches a class rather than parsing a message::

    try:
        await db.update_task(id, request)
    except NeedsConfirmation as refusal:
        print(refusal.details)  # what the write would close over
"""

from __future__ import annotations

import json
from typing import Any, ClassVar

from arlesh._native import NativeError


class ArleshError(Exception):
    """A failure from the core. ``kind`` is its ``WireError`` kind; ``details`` its structured
    context, when it has any."""

    KIND: ClassVar[str] = "internal"

    def __init__(self, message: str, details: Any = None, kind: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details
        self.kind: str = kind if kind is not None else self.KIND


class NotFound(ArleshError):
    """The node, row or file named does not exist."""

    KIND = "not_found"


class ContainmentViolated(ArleshError):
    """The write would put a window outside the one that must contain it."""

    KIND = "containment_violated"


class InvalidRequest(ArleshError):
    """The request is invalid given its inputs or the board as it stands."""

    KIND = "invalid_request"


class NeedsConfirmation(ArleshError):
    """The write is valid but would destroy something: ``details`` says what. Send it again with
    ``confirmed=True`` (or, for cycles, a ``reconcile``) to go ahead."""

    KIND = "needs_confirmation"


class NeedsTimeScope(ArleshError):
    """The write would leave a Commitment with no window: send it again with a Time Scope."""

    KIND = "needs_time_scope"


class NotPermitted(ArleshError):
    """The request may not touch what it names — for instance a write-open while the desktop app
    holds the database."""

    KIND = "not_permitted"


class AmbiguousId(ArleshError):
    """A short id matched several nodes; ``details["candidates"]`` lists them."""

    KIND = "ambiguous_id"


class StatusChanged(ArleshError):
    """A compare-and-set found a status other than the one expected; ``details["current"]``."""

    KIND = "status_changed"


class DatabaseError(ArleshError):
    """The database failed."""

    KIND = "database"


class InternalError(ArleshError):
    """Something unexpected: a bug, or data the core cannot read."""

    KIND = "internal"


_BY_KIND: dict[str, type[ArleshError]] = {
    error.KIND: error
    for error in (
        NotFound,
        ContainmentViolated,
        InvalidRequest,
        NeedsConfirmation,
        NeedsTimeScope,
        NotPermitted,
        AmbiguousId,
        StatusChanged,
        DatabaseError,
        InternalError,
    )
}


def from_native(error: NativeError) -> ArleshError:
    """The ``ArleshError`` a native failure stands for.

    The native side raises one exception whose argument is the failure as JSON. A kind this
    package does not know — a newer core — arrives as plain ``ArleshError`` with that kind kept.
    """
    payload = json.loads(str(error.args[0])) if error.args else {}
    kind = str(payload.get("kind", "internal"))
    message = str(payload.get("message", ""))
    known = _BY_KIND.get(kind)
    if known is not None:
        return known(message, payload.get("details"))
    return ArleshError(message, payload.get("details"), kind)
