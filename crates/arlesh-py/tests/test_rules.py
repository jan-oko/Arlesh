"""The pure rules from Python, held to what the Rust tests assert for the same inputs.

Each expectation here is copied from a Rust test (named in the docstring) or replayed from the
shared conformance corpus, so a Python caller is shown to get the core's answer, not a copy's.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from arlesh import InvalidRequest, rules
from arlesh.models import (
    Archival,
    Clock,
    ClockWindow,
    DurationSpec,
    ExpectationStatus,
    InstanceTiming,
    IterationStatus,
    MissPolicy,
    NodeKind,
    OnScopeExit,
    PartOfDay,
    Resolution,
    ScopeKeyDay,
    ScopeKind,
    SlotWindow,
    StatusAfterRefused,
    StatusAfterWritten,
    StatusOrdinary,
    StatusStep,
    TaskStatus,
    Timing,
    Verdict,
    VerdictPress,
)

REPOSITORY = Path(__file__).resolve().parents[3]
"""The repository root, where the shared conformance corpora live."""


def at(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


WINDOW = (at("2026-01-05T00:00:00"), at("2026-01-12T00:00:00"))
"""`tasks/rules/lifecycle/tests.rs::window`."""


def _corpus_cases() -> list[dict[str, Any]]:
    corpus = json.loads((REPOSITORY / "conformance" / "scope-keys.json").read_text())
    cases: list[dict[str, Any]] = corpus["cases"]
    return cases


@pytest.mark.parametrize("case", _corpus_cases(), ids=lambda case: str(case["text"]))
def test_every_scope_key_in_the_shared_corpus_has_its_key_and_window(case: dict[str, Any]) -> None:
    """`tests/structure/scopes.rs::every_key_in_the_shared_corpus_has_the_same_canonical_text_here`."""
    cell = case["cell"]
    if cell["kind"] == "part_of_day":
        scope = rules.part_scope(date.fromisoformat(cell["date"]), PartOfDay(cell["part"]))
    elif cell["kind"] == "exact":
        scope = rules.exact_scope(at(cell["start"]), at(cell["end"]))
    else:
        scope = rules.scope_containing(ScopeKind(cell["kind"]), date.fromisoformat(cell["date"]))
    assert scope.id.model_dump(mode="json") == case["key"]
    resolved = rules.resolve_scope(scope.id, at("2026-01-01T00:00:00"))
    assert at(resolved.start) == at(case["window"]["start"])
    assert at(resolved.end) == at(case["window"]["end"])


def test_a_scope_key_that_is_not_canonical_is_refused() -> None:
    with pytest.raises(InvalidRequest):
        rules.scope_containing(ScopeKind.part_of_day, date(2026, 9, 23))


@pytest.mark.parametrize(
    ("window", "now", "timing"),
    [
        (None, "2030-01-01T00:00:00", Timing.active),
        (WINDOW, "2026-01-01T00:00:00", Timing.pending),
        (WINDOW, "2026-01-08T09:00:00", Timing.active),
        (WINDOW, "2026-01-12T00:00:00", Timing.lapsed),
        (WINDOW, "2026-01-20T00:00:00", Timing.lapsed),
    ],
)
def test_timing_matches_the_rust_tests(
    window: tuple[datetime, datetime] | None, now: str, timing: Timing
) -> None:
    """`tasks/rules/lifecycle/tests.rs`: the four Timing tests."""
    assert rules.derive_timing(window, at(now)) == timing


@pytest.mark.parametrize(
    ("timing", "resolved", "on_exit", "resolution"),
    [
        (Timing.pending, False, OnScopeExit.archive, None),
        (Timing.active, False, OnScopeExit.archive, None),
        (Timing.lapsed, True, OnScopeExit.archive, Resolution.completed),
        (Timing.lapsed, True, OnScopeExit.keep, Resolution.completed),
        (Timing.lapsed, True, None, Resolution.completed),
        (Timing.lapsed, False, OnScopeExit.archive, Resolution.missed),
        (Timing.lapsed, False, OnScopeExit.keep, None),
        (Timing.lapsed, False, None, None),
    ],
)
def test_resolution_matches_the_rust_tests(
    timing: Timing, resolved: bool, on_exit: OnScopeExit | None, resolution: Resolution | None
) -> None:
    """`tasks/rules/lifecycle/tests.rs`: the Resolution tests."""
    assert rules.derive_resolution(timing, resolved, on_exit) == resolution


def test_completion_forces_archival_and_overriding_frozen_is_a_conflict() -> None:
    """`completed_forces_archival_…` and `forcing_archival_over_a_manually_frozen_item_…`."""
    completed = rules.derive_archival(None, Resolution.completed)
    assert (completed.effective, completed.conflict) == (Archival.archived, False)
    frozen = rules.derive_archival(Archival.frozen, Resolution.missed)
    assert (frozen.effective, frozen.conflict) == (Archival.archived, True)
    live = rules.derive_archival(None, None)
    assert (live.effective, live.conflict) == (Archival.live, False)


def test_an_unfinished_item_past_its_due_is_overdue() -> None:
    assert rules.derive_overdue(WINDOW, False, Archival.live, at("2026-01-12T00:00:00"))
    assert not rules.derive_overdue(WINDOW, True, Archival.live, at("2026-01-12T00:00:00"))
    assert not rules.derive_overdue(WINDOW, False, Archival.live, at("2026-01-11T23:59:00"))


def test_the_item_state_combines_timing_resolution_and_archival() -> None:
    state = rules.derive_item_state(
        WINDOW, OnScopeExit.archive, None, False, None, at("2026-01-20T00:00:00")
    )
    assert state.timing == Timing.lapsed
    assert state.resolution == Resolution.missed
    assert state.archival == Archival.archived


def four_weeks() -> list[SlotWindow]:
    """`flows/rules/habits/tests.rs::four_weeks`: weeks from Monday 2026-01-05."""
    start = at("2026-01-05T00:00:00")
    return [
        SlotWindow(
            index=index,
            scope_id=ScopeKeyDay(kind="day", date=f"2000-04-{10 + index:02d}"),
            start=start + timedelta(weeks=index),
            end=start + timedelta(weeks=index + 1),
        )
        for index in range(4)
    ]


def test_an_archive_clock_lapses_passed_unfinished_iterations() -> None:
    """`archive_lapses_passed_unfinished_and_keeps_the_current_active`."""
    iterations = rules.classify_habit_iterations(
        four_weeks()[:3],
        Clock(ClockWindow(window=MissPolicy.archive)),
        {0: at("2026-01-06T00:00:00")},
        at("2026-01-22T00:00:00"),
    )
    assert [(it.index, it.status) for it in iterations] == [
        (0, IterationStatus.done),
        (1, IterationStatus.lapsed),
        (2, IterationStatus.active),
    ]


def test_an_owed_clock_keeps_every_unfinished_iteration_active() -> None:
    """`owed_keeps_every_unfinished_iteration_active`."""
    iterations = rules.classify_habit_iterations(
        four_weeks()[:3],
        Clock(ClockWindow(window=MissPolicy.owed)),
        {1: at("2026-01-14T00:00:00")},
        at("2026-01-22T00:00:00"),
    )
    assert [(it.index, it.status) for it in iterations] == [
        (0, IterationStatus.active),
        (1, IterationStatus.done),
        (2, IterationStatus.active),
    ]
    assert all(it.missed_from is None for it in iterations)


def test_the_status_cycle_steps_and_refuses_a_compound() -> None:
    todo = StatusOrdinary(kind="ordinary", status=TaskStatus.todo)
    written = rules.status_after(StatusStep.advance, todo, False).root
    assert isinstance(written, StatusAfterWritten)
    assert written.status == StatusOrdinary(kind="ordinary", status=TaskStatus.in_progress)
    assert rules.next_status(todo) == written.status
    refused = rules.status_after(StatusStep.advance, todo, True).root
    assert isinstance(refused, StatusAfterRefused)


def test_a_compound_reads_its_progress_off_its_items() -> None:
    assert rules.compound_progress([TaskStatus.done, TaskStatus.done]) == TaskStatus.done
    assert rules.compound_progress([TaskStatus.todo, TaskStatus.done]) == TaskStatus.started
    assert rules.compound_progress([TaskStatus.todo, TaskStatus.in_progress]) == (
        TaskStatus.in_progress
    )


def test_parenting_allows_a_task_under_a_goal_and_not_a_domain_under_a_task() -> None:
    assert rules.may_parent(NodeKind.task, NodeKind.goal)
    assert not rules.may_parent(NodeKind.domain, NodeKind.task)


def test_the_cycle_navigator_steps_down_from_the_flows_period() -> None:
    """`cycle_grid/tests.rs::the_navigator_steps_from_the_flows_period_down_…`."""
    levels = rules.cycle_levels(2, ScopeKind.week, ScopeKind.part_of_day)
    assert [(level.kind, level.count) for level in levels] == [
        (ScopeKind.week, 2),
        (ScopeKind.day, 7),
        (ScopeKind.part_of_day, 6),
    ]
    assert rules.cycle_levels(1, ScopeKind.day, ScopeKind.week) == []


def test_the_verdict_cycle_walks_unresolved_kept_broken() -> None:
    """`gestures/tests.rs::enter_walks_the_verdict_unresolved_kept_broken_unresolved`."""
    assert rules.verdict_after(VerdictPress.cycle, Verdict.unresolved) == Verdict.kept
    assert rules.verdict_after(VerdictPress.cycle, Verdict.kept) == Verdict.broken
    assert rules.verdict_after(VerdictPress.cycle, Verdict.broken) == Verdict.unresolved


def test_a_commitment_nobody_judged_stays_unresolved_after_its_window() -> None:
    """`commitment_tests.rs::a_commitment_nobody_judged_stays_unresolved_…`."""
    state = rules.derive_commitment_state(
        WINDOW, Verdict.unresolved, None, at("2027-01-01T00:00:00")
    )
    assert (state.timing, state.verdict) == (Timing.lapsed, Verdict.unresolved)


def test_an_explicit_due_wins_and_a_backlogged_item_has_none() -> None:
    governance = (WINDOW, OnScopeExit.keep)
    assert rules.effective_due(WINDOW, None, False) == WINDOW
    assert rules.effective_due(None, governance, False) == WINDOW
    assert rules.effective_due(None, governance, True) is None
    assert rules.effective_due(None, (WINDOW, OnScopeExit.archive), False) is None


def test_a_habit_occurrence_ahead_of_its_window_is_not_yet_open() -> None:
    timing = rules.habit_instance_timing(
        Clock(ClockWindow(window=MissPolicy.archive)),
        IterationStatus.active,
        WINDOW,
        at("2026-01-01T00:00:00"),
    )
    assert timing == InstanceTiming.pending


def test_a_wait_checked_daily_is_next_checked_a_day_later() -> None:
    every = DurationSpec(n=1, kind="day")
    assert rules.advance_check(at("2026-09-01T09:00:00"), every) == at("2026-09-02T09:00:00")
    hourly = DurationSpec(n=2, kind="hour")
    assert rules.advance_check(at("2026-09-01T09:00:00"), hourly) == at("2026-09-01T11:00:00")


def test_a_pending_wait_counts_as_started_and_a_released_one_as_done() -> None:
    """`compound.rs::expectation_reading`: something is under way, somewhere else."""
    assert rules.expectation_reading(ExpectationStatus.pending) == TaskStatus.started
    assert rules.expectation_reading(ExpectationStatus.released) == TaskStatus.done


def test_a_key_names_its_scope() -> None:
    assert rules.scope(ScopeKeyDay(kind="day", date="2026-09-23")).label == "2026-09-23"
