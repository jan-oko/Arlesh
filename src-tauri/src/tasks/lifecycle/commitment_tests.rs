use super::*;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").expect("a parseable instant")
}

/// Tuesday 6 January 2026, as a single-day window.
fn one_day() -> Bounds {
    (at("2026-01-06T00:00:00"), at("2026-01-07T00:00:00"))
}

fn duration(n: i64, kind: &str) -> DurationSpec {
    DurationSpec { n, kind: kind.to_string() }
}

fn state(verdict: Verdict, verdict_window: Option<DurationSpec>, now: &str) -> CommitmentState {
    derive_commitment_state(Some(one_day()), verdict, verdict_window.as_ref(), at(now))
}

// --- The Verdict is never derived ---

#[test]
fn a_commitment_nobody_judged_stays_unresolved_however_long_its_window_has_been_shut() {
    // The inversion this kind exists for: a Task untouched at window close is Missed, and a
    // Commitment untouched is not Broken — it is unjudged, and says so.
    let long_after = state(Verdict::Unresolved, None, "2030-01-01T00:00:00");
    assert_eq!(long_after.timing, Timing::Lapsed);
    assert_eq!(long_after.verdict, Verdict::Unresolved);
}

#[test]
fn the_verdict_comes_back_exactly_as_it_went_in() {
    for verdict in [Verdict::Unresolved, Verdict::Kept, Verdict::Broken] {
        for now in ["2026-01-01T00:00:00", "2026-01-06T12:00:00", "2030-01-01T00:00:00"] {
            assert_eq!(state(verdict, None, now).verdict, verdict);
        }
    }
}

// --- Timing ---

#[test]
fn timing_reads_the_window_alone_and_ignores_the_verdict() {
    assert_eq!(state(Verdict::Kept, None, "2026-01-05T00:00:00").timing, Timing::Pending);
    assert_eq!(state(Verdict::Broken, None, "2026-01-06T09:00:00").timing, Timing::Active);
    assert_eq!(state(Verdict::Unresolved, None, "2026-01-07T00:00:00").timing, Timing::Lapsed);
}

#[test]
fn a_commitment_with_no_effective_window_is_active_and_never_archives() {
    // Unreachable through the write path, which refuses a Commitment with no effective scope.
    // Kept total anyway: a derivation that panicked on a row the database should not hold
    // would take the whole board down over one bad row.
    let derived = derive_commitment_state(None, Verdict::Unresolved, None, at("2030-01-01T00:00:00"));
    assert_eq!(derived.timing, Timing::Active);
    assert_eq!(derived.archival, Archival::Live);
}

// --- Archival: a judged commitment settles once its window shuts ---

#[test]
fn a_judged_commitment_inside_its_window_is_still_live() {
    // Judged early, but the window is what makes it over: a kept commitment can still be
    // broken before midnight.
    for verdict in [Verdict::Kept, Verdict::Broken] {
        assert_eq!(state(verdict, None, "2026-01-06T09:00:00").archival, Archival::Live);
    }
}

#[test]
fn a_judged_commitment_archives_once_its_window_has_passed() {
    for verdict in [Verdict::Kept, Verdict::Broken] {
        assert_eq!(state(verdict, None, "2026-01-07T00:00:00").archival, Archival::Archived);
    }
}

// --- Archival: the Verdict Window ---

#[test]
fn an_unresolved_commitment_with_no_verdict_window_never_archives_on_its_own() {
    assert_eq!(state(Verdict::Unresolved, None, "2030-01-01T00:00:00").archival, Archival::Live);
}

#[test]
fn an_unresolved_commitment_stays_answerable_until_its_verdict_window_runs_out() {
    // Two days to record last night's verdict: still answerable the next morning, gone the
    // day after.
    let two_days = Some(duration(2, "day"));
    assert_eq!(state(Verdict::Unresolved, two_days.clone(), "2026-01-07T09:00:00").archival, Archival::Live);
    assert_eq!(state(Verdict::Unresolved, two_days.clone(), "2026-01-08T23:59:59").archival, Archival::Live);
    assert_eq!(state(Verdict::Unresolved, two_days, "2026-01-09T00:00:00").archival, Archival::Archived);
}

#[test]
fn a_verdict_window_that_has_run_out_archives_without_touching_the_verdict() {
    // The only automatic state change in the kind, and it moves Archival alone. Not having
    // judged something is itself part of the record, so "unresolved" survives the archiving.
    let expired = state(Verdict::Unresolved, Some(duration(1, "day")), "2026-01-20T00:00:00");
    assert_eq!(expired.archival, Archival::Archived);
    assert_eq!(expired.verdict, Verdict::Unresolved);
}

#[test]
fn the_verdict_window_only_ever_runs_against_an_unresolved_commitment() {
    // A judged one is settled by its window, not by this: recording a verdict on the last
    // answerable day cannot make it *less* archived than staying silent would have.
    let long_gone = "2030-01-01T00:00:00";
    for verdict in [Verdict::Kept, Verdict::Broken] {
        assert_eq!(state(verdict, Some(duration(5, "season")), long_gone).archival, Archival::Archived);
    }
}

// --- The Verdict Window's kind is independent of the commitment's own ---

#[test]
fn a_verdict_window_is_counted_in_its_own_scope_kind() {
    // A one-day commitment answerable for a week, which a Duration tied to the commitment's
    // own kind could not express.
    let a_week = Some(duration(1, "week"));
    assert_eq!(state(Verdict::Unresolved, a_week.clone(), "2026-01-13T23:00:00").archival, Archival::Live);
    assert_eq!(state(Verdict::Unresolved, a_week, "2026-01-14T00:00:00").archival, Archival::Archived);
}

#[test]
fn a_deadline_is_the_windows_end_advanced_by_the_duration() {
    let end = at("2026-01-07T00:00:00");
    assert_eq!(verdict_deadline(Some(one_day()), Some(&duration(3, "day"))), Some(at("2026-01-10T00:00:00")));
    assert_eq!(verdict_deadline(Some(one_day()), Some(&duration(2, "week"))), Some(at("2026-01-21T00:00:00")));
    assert_eq!(verdict_deadline(Some(one_day()), Some(&duration(1, "month"))), Some(at("2026-02-07T00:00:00")));
    assert_eq!(verdict_deadline(Some(one_day()), Some(&duration(1, "season"))), Some(at("2026-04-07T00:00:00")));
    assert_eq!(verdict_deadline(Some(one_day()), Some(&duration(0, "day"))), Some(end));
}

#[test]
fn a_deadline_needs_both_a_window_and_a_duration() {
    assert_eq!(verdict_deadline(None, Some(&duration(1, "day"))), None);
    assert_eq!(verdict_deadline(Some(one_day()), None), None);
}

#[test]
fn a_sub_day_or_unrecognised_duration_kind_bounds_nothing() {
    // `part` and `exact` are scope kinds but not *countable* ones — "two evenings after" has
    // no arithmetic. Reading them as no window at all beats inventing an interval.
    for kind in ["part", "exact", "fortnight", ""] {
        assert_eq!(
            verdict_deadline(Some(one_day()), Some(&duration(2, kind))),
            None,
            "{kind} must not silently resolve to some other unit",
        );
    }
}

#[test]
fn a_duration_the_calendar_cannot_express_bounds_nothing_rather_than_wrapping() {
    // A negative count and an absurd one both fall out as "no deadline", which leaves the
    // commitment answerable — the safe direction, since the alternative is archiving
    // something the moment it is created.
    assert_eq!(verdict_deadline(Some(one_day()), Some(&duration(-3, "month"))), None);
    assert_eq!(verdict_deadline(Some(one_day()), Some(&duration(i64::MAX, "season"))), None);
    assert_eq!(verdict_deadline(Some(one_day()), Some(&duration(i64::MAX, "day"))), None);
}
