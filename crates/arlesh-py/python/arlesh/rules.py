"""Arlesh's pure rules, as plain functions over values.

These are the core's own rules (its ``rules`` layer), not Python copies: each call crosses into
Rust and back. They read no database and no clock — pass ``now`` where a rule needs one — so they
are ordinary calls, not coroutines.

A window is a ``(start, end)`` pair of naive datetimes, half-open: ``start <= t < end``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date, datetime
from typing import Any, TypeVar

from pydantic import BaseModel, TypeAdapter
from pydantic_core import to_json

from arlesh import _native
from arlesh.errors import from_native
from arlesh.models import (
    Archival,
    ArchivalResult,
    Clock,
    CommitmentState,
    CycleLevel,
    DerivedState,
    DurationSpec,
    ExpectationStatus,
    HabitIteration,
    InstanceTiming,
    IterationStatus,
    NodeKind,
    OnScopeExit,
    PartOfDay,
    Resolution,
    ResolvedScope,
    Scope,
    ScopeKey,
    ScopeKind,
    SlotWindow,
    Status,
    StatusAfter,
    StatusStep,
    TaskStatus,
    Timing,
    Verdict,
    VerdictPress,
)

Window = tuple[datetime, datetime]
"""A half-open ``[start, end)`` window."""

T = TypeVar("T")


def _wire(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", exclude_unset=True, by_alias=True)
    if isinstance(value, list | tuple):
        return [_wire(item) for item in value]
    if isinstance(value, Mapping):
        return {str(key): _wire(item) for key, item in value.items()}
    return value


def _rule(answer: TypeAdapter[T], rule: str, **arguments: Any) -> T:
    """Runs the rule ``rule`` and reads its answer as ``answer`` describes."""
    request = {"rule": rule, **{name: _wire(value) for name, value in arguments.items()}}
    try:
        raw = _native.rule(to_json(request).decode())
    except _native.NativeError as error:
        raise from_native(error) from None
    return answer.validate_json(raw)


# ---- Scopes -------------------------------------------------------------------------------------


def scope_containing(kind: ScopeKind, day: date) -> Scope:
    """The Season, Month, Week or Day of ``kind`` that holds ``day``. Every canonical scope runs
    from 02:00 to 02:00."""
    return _rule(_SCOPE, "scope_containing", kind=kind, date=day)


def part_scope(day: date, part: PartOfDay) -> Scope:
    """The Part-of-Day scope ``part`` on ``day``. Night belongs to the day it starts on."""
    return _rule(_SCOPE, "part_scope", date=day, part=part)


def exact_scope(start: datetime, end: datetime) -> Scope:
    """An Exact scope over ``[start, end)``."""
    return _rule(_SCOPE, "exact_scope", start=start, end=end)


def scope(key: ScopeKey) -> Scope:
    """The scope a key names."""
    return _rule(_SCOPE, "scope", key=key)


def resolve_scope(key: ScopeKey, now: datetime) -> ResolvedScope:
    """A scope's window, and where ``now`` stands in it."""
    return _rule(_RESOLVED, "resolve_scope", key=key, now=now)


# ---- Lifecycle ----------------------------------------------------------------------------------


def derive_timing(window: Window | None, now: datetime) -> Timing:
    """Pending before the window, Active in it, Lapsed after. No window is Active."""
    return _rule(_TIMING, "derive_timing", window=window, now=now)


def derive_resolution(
    timing: Timing, resolved: bool, on_exit: OnScopeExit | None
) -> Resolution | None:
    """How a passed window settled an item: Completed, Missed under Archive, or nothing."""
    return _rule(
        _RESOLUTION, "derive_resolution", timing=timing, resolved=resolved, on_exit=on_exit
    )


def effective_due(
    explicit: Window | None,
    governance: tuple[Window, OnScopeExit] | None,
    backlogged: bool,
) -> Window | None:
    """The window whose end makes an item late: its own due, else its governing window under
    Keep Overdue, else none."""
    return _rule(
        _OPTIONAL_WINDOW,
        "effective_due",
        explicit=explicit,
        governance=governance,
        backlogged=backlogged,
    )


def derive_overdue(due: Window | None, resolved: bool, archival: Archival, now: datetime) -> bool:
    """Unfinished, not archived, and past the due's end."""
    return _rule(_BOOL, "derive_overdue", due=due, resolved=resolved, archival=archival, now=now)


def derive_archival(stored: Archival | None, resolution: Resolution | None) -> ArchivalResult:
    """An item's effective Archival, and whether it overrode one set by hand."""
    return _rule(_ARCHIVAL, "derive_archival", stored=stored, resolution=resolution)


def derive_item_state(
    window: Window | None,
    on_exit: OnScopeExit | None,
    due: Window | None,
    resolved: bool,
    stored: Archival | None,
    now: datetime,
) -> DerivedState:
    """An item's whole derived state: Timing, Resolution, Overdue and Archival."""
    return _rule(
        _DERIVED_STATE,
        "derive_item_state",
        window=window,
        on_exit=on_exit,
        due=due,
        resolved=resolved,
        stored=stored,
        now=now,
    )


def derive_commitment_state(
    window: Window | None,
    verdict: Verdict,
    verdict_window: DurationSpec | None,
    now: datetime,
) -> CommitmentState:
    """A Commitment's derived state."""
    return _rule(
        _COMMITMENT_STATE,
        "derive_commitment_state",
        window=window,
        verdict=verdict,
        verdict_window=verdict_window,
        now=now,
    )


# ---- Habits -------------------------------------------------------------------------------------


def habit_instance_timing(
    clock: Clock, iteration_status: IterationStatus, window: Window, now: datetime
) -> InstanceTiming:
    """Where a Habit occurrence stands, from its iteration's status and window."""
    return _rule(
        _INSTANCE_TIMING,
        "habit_instance_timing",
        clock=clock,
        iteration_status=iteration_status,
        window=window,
        now=now,
    )


def classify_habit_iterations(
    slots: Sequence[SlotWindow],
    clock: Clock,
    resolved: Mapping[int, datetime],
    now: datetime,
) -> list[HabitIteration]:
    """Classifies a Habit's iteration windows under its clock. ``resolved`` maps each finished
    iteration's index to when it was done."""
    return _rule(
        _ITERATIONS,
        "classify_habit_iterations",
        slots=list(slots),
        clock=clock,
        resolved=sorted(resolved.items()),
        now=now,
    )


def cycle_levels(flow_n: int, flow_kind: ScopeKind, target: ScopeKind) -> list[CycleLevel]:
    """The cycle navigator's levels, from a Flow's period down to ``target``."""
    return _rule(_CYCLE_LEVELS, "cycle_levels", flow_n=flow_n, flow_kind=flow_kind, target=target)


# ---- Gestures and structure ---------------------------------------------------------------------


def next_status(current: Status) -> Status:
    """The next status in the status cycle."""
    return _rule(_STATUS, "next_status", current=current)


def status_after(step: StatusStep, current: Status, compound: bool) -> StatusAfter:
    """What a status gesture makes of a status, or why it writes nothing."""
    return _rule(_STATUS_AFTER, "status_after", step=step, current=current, compound=compound)


def verdict_after(press: VerdictPress, current: Verdict) -> Verdict:
    """What a verdict control makes of a verdict."""
    return _rule(_VERDICT, "verdict_after", press=press, current=current)


def may_parent(child: NodeKind, parent: NodeKind) -> bool:
    """Whether a node of kind ``child`` may sit under one of kind ``parent``."""
    return _rule(_BOOL, "may_parent", child=child, parent=parent)


def compound_progress(states: Sequence[TaskStatus]) -> TaskStatus:
    """A compound's status, read off its items' statuses."""
    return _rule(_TASK_STATUS, "compound_progress", states=list(states))


def expectation_reading(status: ExpectationStatus) -> TaskStatus:
    """A wait's status as a compound counts it."""
    return _rule(_TASK_STATUS, "expectation_reading", status=status)


def advance_check(at: datetime, every: DurationSpec) -> datetime | None:
    """The next check of a wait checked every ``every``, after one at ``at``."""
    return _rule(_OPTIONAL_INSTANT, "advance_check", at=at, every=every)


_SCOPE = TypeAdapter(Scope)
_RESOLVED = TypeAdapter(ResolvedScope)
_TIMING = TypeAdapter(Timing)
_RESOLUTION: TypeAdapter[Resolution | None] = TypeAdapter(Resolution | None)
_OPTIONAL_WINDOW: TypeAdapter[Window | None] = TypeAdapter(Window | None)
_BOOL = TypeAdapter(bool)
_ARCHIVAL = TypeAdapter(ArchivalResult)
_DERIVED_STATE = TypeAdapter(DerivedState)
_COMMITMENT_STATE = TypeAdapter(CommitmentState)
_INSTANCE_TIMING = TypeAdapter(InstanceTiming)
_ITERATIONS = TypeAdapter(list[HabitIteration])
_CYCLE_LEVELS = TypeAdapter(list[CycleLevel])
_STATUS: TypeAdapter[Status] = TypeAdapter(Status)
_STATUS_AFTER = TypeAdapter(StatusAfter)
_VERDICT = TypeAdapter(Verdict)
_TASK_STATUS = TypeAdapter(TaskStatus)
_OPTIONAL_INSTANT: TypeAdapter[datetime | None] = TypeAdapter(datetime | None)
