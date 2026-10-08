"""The few HTTP-side models: the error body, and the parameter objects of the rule routes.

Every node, request and answer model is the core's own, generated into :mod:`arlesh.models`;
these hold only what the HTTP layer adds around them.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from arlesh.models import Archival, DurationSpec, OnScopeExit, Verdict, WireErrorKind

Window = tuple[datetime, datetime]
"""A half-open ``[start, end)`` window."""


class ErrorBody(BaseModel):
    """A refused or failed request: the core's ``WireError`` as it crosses HTTP."""

    kind: WireErrorKind
    """What went wrong, as the core classifies it. Branch on this, not on the status."""
    message: str
    """A human-readable account. Not for parsing."""
    details: Any = None
    """Structured context, when there is any: what a confirmation is about, why an open or a
    token was refused (``details.reason``), the validation errors of a malformed request."""
    transaction_id: str | None = None
    """The request's id in the server's log, on a server-side (5xx) failure."""


class ItemStateQuestion(BaseModel):
    """The inputs of an item's derived state, as the rule takes them."""

    window: Window | None = None
    on_exit: OnScopeExit | None = None
    due: Window | None = None
    resolved: bool = False
    stored: Archival | None = None
    now: datetime


class CommitmentStateQuestion(BaseModel):
    """The inputs of a Commitment's derived state, as the rule takes them."""

    window: Window | None = None
    verdict: Verdict
    verdict_window: DurationSpec | None = None
    now: datetime
