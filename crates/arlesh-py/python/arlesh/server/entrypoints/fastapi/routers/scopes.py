"""Scopes and the pure rules a client needs, so it reimplements neither calendar nor lifecycle.

These run the core's own rules (``arlesh.rules``), which read no database and no clock.
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter

from arlesh import rules
from arlesh.models import (
    CommitmentState,
    DerivedState,
    ResolvedScope,
    Scope,
    ScopeKey,
    ScopeKind,
)
from arlesh.server.entrypoints.fastapi.exception_handling.exception_handlers import (
    ERROR_RESPONSES,
)
from arlesh.server.entrypoints.fastapi.models import CommitmentStateQuestion, ItemStateQuestion


class ScopesRouter(APIRouter):
    """``/scopes``: resolving scope keys to windows."""

    def __init__(self) -> None:
        super().__init__(tags=["scopes"], responses=ERROR_RESPONSES)
        self.get("/containing")(self._containing)
        self.post("/resolve")(self._resolve)

    async def _containing(self, kind: ScopeKind, date: date) -> Scope:
        """The Season, Month, Week or Day of ``kind`` that holds ``date``."""
        return rules.scope_containing(kind, date)

    async def _resolve(self, key: ScopeKey, now: datetime) -> ResolvedScope:
        """A scope's ``[start, end)`` window, and whether ``now`` falls in it. The body is the
        scope's key, e.g. ``{"kind": "week", "date": "2026-06-14"}``."""
        return rules.resolve_scope(key, now)


class RulesRouter(APIRouter):
    """``/rules``: the derived lifecycles."""

    def __init__(self) -> None:
        super().__init__(tags=["rules"], responses=ERROR_RESPONSES)
        self.post("/item-state")(self._item_state)
        self.post("/commitment-state")(self._commitment_state)

    async def _item_state(self, question: ItemStateQuestion) -> DerivedState:
        """An item's Timing, Resolution, Overdue and Archival."""
        return rules.derive_item_state(
            question.window,
            question.on_exit,
            question.due,
            question.resolved,
            question.stored,
            question.now,
        )

    async def _commitment_state(self, question: CommitmentStateQuestion) -> CommitmentState:
        """A Commitment's derived state."""
        return rules.derive_commitment_state(
            question.window, question.verdict, question.verdict_window, question.now
        )
