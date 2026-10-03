"""Scopes and the pure rules a client needs, so it reimplements neither calendar nor lifecycle.

These run the core's own rules (``arlesh.rules``), which read no database and no clock. They
answer what a client asks without writing, so they need no client header.
"""

from __future__ import annotations

from datetime import date, datetime

from arlesh import rules
from arlesh.models import (
    Archival,
    CommitmentState,
    DerivedState,
    DurationSpec,
    OnScopeExit,
    ResolvedScope,
    Scope,
    ScopeKey,
    ScopeKind,
    Verdict,
)
from pydantic import BaseModel

from arlesh_api.routes import make_router

router = make_router("/scopes", "scopes")
derive = make_router("/rules", "rules")

Window = tuple[datetime, datetime]


@router.get("/containing")
async def scope_containing(kind: ScopeKind, date: date) -> Scope:
    """The Season, Month, Week or Day of ``kind`` that holds ``date``."""
    return rules.scope_containing(kind, date)


@router.post("/resolve")
async def resolve_scope(key: ScopeKey, now: datetime) -> ResolvedScope:
    """A scope's ``[start, end)`` window, and whether ``now`` falls in it. The body is the
    scope's key, e.g. ``{"kind": "week", "date": "2026-06-14"}``."""
    return rules.resolve_scope(key, now)


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


@derive.post("/item-state")
async def derive_item_state(question: ItemStateQuestion) -> DerivedState:
    """An item's Timing, Resolution, Overdue and Archival."""
    return rules.derive_item_state(
        question.window,
        question.on_exit,
        question.due,
        question.resolved,
        question.stored,
        question.now,
    )


@derive.post("/commitment-state")
async def derive_commitment_state(question: CommitmentStateQuestion) -> CommitmentState:
    """A Commitment's derived state."""
    return rules.derive_commitment_state(
        question.window, question.verdict, question.verdict_window, question.now
    )
