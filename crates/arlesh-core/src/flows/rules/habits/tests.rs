use super::*;
use crate::scopes::key::test_key;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

/// Four contiguous week windows starting 2026-01-05 (Mon): W0..W3, scope ids 100..103. Each is
/// the half-open `[Mon 00:00, next Mon 00:00)`.
fn four_weeks() -> Vec<SlotWindow> {
    (0..4)
        .map(|i| {
            let start = at("2026-01-05T00:00:00") + chrono::Duration::weeks(i);
            SlotWindow {
                index: i,
                scope_id: test_key(100 + i),
                start,
                end: start + chrono::Duration::weeks(1),
            }
        })
        .collect()
}

fn statuses(iters: &[HabitIteration]) -> Vec<(i64, IterationStatus)> {
    iters.iter().map(|it| (it.index, it.status)).collect()
}

const ARCHIVE: Clock = Clock::Window(MissPolicy::Archive);
const OWED: Clock = Clock::Window(MissPolicy::Owed);
const OVERDUE: Clock = Clock::Window(MissPolicy::Overdue);

fn missed_from(iters: &[HabitIteration]) -> Vec<(i64, Option<i64>)> {
    iters.iter().map(|it| (it.index, it.missed_from)).collect()
}

#[test]
fn archive_lapses_passed_unfinished_and_keeps_the_current_active() {
    let slots = four_weeks();
    let resolved = HashMap::from([(0, at("2026-01-06T00:00:00"))]); // W0 done, W1/W2 skipped
    let now = at("2026-01-22T00:00:00"); // inside W2 (2026-01-19..26)
    let result = classify_iterations(&slots[..3], ARCHIVE, &resolved, now);
    assert_eq!(
        statuses(&result),
        vec![
            (0, IterationStatus::Done),
            (1, IterationStatus::Lapsed),
            (2, IterationStatus::Active),
        ]
    );
}

#[test]
fn owed_keeps_every_unfinished_iteration_active() {
    let slots = four_weeks();
    let resolved = HashMap::from([(1, at("2026-01-14T00:00:00"))]);
    let now = at("2026-01-22T00:00:00");
    let result = classify_iterations(&slots[..3], OWED, &resolved, now);
    assert_eq!(
        statuses(&result),
        vec![
            (0, IterationStatus::Active),
            (1, IterationStatus::Done),
            (2, IterationStatus::Active),
        ]
    );
    assert!(result.iter().all(|it| it.missed_from.is_none()));
}

#[test]
fn overdue_misses_every_earlier_unfinished_iteration_and_the_open_one_carries_the_run() {
    let slots = four_weeks();
    let resolved = HashMap::new();
    let now = at("2026-01-22T00:00:00"); // inside W2
    let result = classify_iterations(&slots[..3], OVERDUE, &resolved, now);
    assert_eq!(
        statuses(&result),
        vec![
            (0, IterationStatus::Missed),
            (1, IterationStatus::Missed),
            (2, IterationStatus::Active),
        ]
    );
    // "W2 from W0": the open iteration carries the run that began at W0.
    assert_eq!(
        missed_from(&result),
        vec![(0, None), (1, None), (2, Some(0))]
    );
}

#[test]
fn overdue_keeps_the_latest_started_iteration_open_however_long_ago_its_window_passed() {
    // One iteration only, long past — as under a Gap, or past the Habit's end.
    let slots = four_weeks();
    let now = at("2026-03-01T00:00:00");
    let result = classify_iterations(&slots[..1], OVERDUE, &HashMap::new(), now);
    assert_eq!(statuses(&result), vec![(0, IterationStatus::Active)]);
    assert_eq!(missed_from(&result), vec![(0, None)]);
}

#[test]
fn overdue_a_completion_breaks_the_run_and_keeps_saying_what_it_made_up_for() {
    let slots = four_weeks();
    // W0 missed; W1 done late; W2 missed; W3 open.
    let resolved = HashMap::from([(1, at("2026-01-15T00:00:00"))]);
    let now = at("2026-01-28T00:00:00"); // inside W3
    let result = classify_iterations(&slots, OVERDUE, &resolved, now);
    assert_eq!(
        statuses(&result),
        vec![
            (0, IterationStatus::Missed),
            (1, IterationStatus::Done),
            (2, IterationStatus::Missed),
            (3, IterationStatus::Active),
        ]
    );
    assert_eq!(
        missed_from(&result),
        vec![(0, None), (1, Some(0)), (2, None), (3, Some(2))]
    );
}

#[test]
fn overdue_with_nothing_missed_carries_nothing() {
    let slots = four_weeks();
    let resolved = HashMap::from([
        (0, at("2026-01-06T00:00:00")),
        (1, at("2026-01-13T00:00:00")),
    ]);
    let now = at("2026-01-22T00:00:00");
    let result = classify_iterations(&slots[..3], OVERDUE, &resolved, now);
    assert_eq!(
        statuses(&result),
        vec![
            (0, IterationStatus::Done),
            (1, IterationStatus::Done),
            (2, IterationStatus::Active),
        ]
    );
    assert!(result.iter().all(|it| it.missed_from.is_none()));
}

#[test]
fn an_interval_chain_classifies_done_and_the_one_open_instance() {
    let slots = four_weeks();
    let resolved = HashMap::from([(0, at("2026-01-08T00:00:00"))]);
    let now = at("2026-02-10T00:00:00"); // long past W1's window: still open, not lapsed
    let result = classify_iterations(&slots[..2], Clock::Interval, &resolved, now);
    assert_eq!(
        statuses(&result),
        vec![(0, IterationStatus::Done), (1, IterationStatus::Active)]
    );
}

#[test]
fn only_window_and_archive_lapses_an_occurrence_on_exit() {
    assert!(ARCHIVE.lapses_on_exit());
    for clock in [OWED, OVERDUE, Clock::Interval] {
        assert!(!clock.lapses_on_exit(), "{clock:?}");
    }
}

#[test]
fn the_unbounded_end_sorts_after_any_real_instant_as_text() {
    let text = UNBOUNDED.format("%Y-%m-%dT%H:%M:%S").to_string();
    assert_eq!(text, "9999-12-31T23:59:59");
    assert!(text.as_str() > "2026-10-01T00:00:00");
}

#[test]
fn every_iteration_carries_its_own_window_end() {
    let slots = four_weeks();
    let resolved = HashMap::new();
    let now = at("2026-01-22T00:00:00");
    let result = classify_iterations(&slots, OWED, &resolved, now);
    let ends: Vec<_> = result.iter().map(|it| it.window_end.as_str()).collect();
    assert_eq!(
        ends,
        vec![
            "2026-01-12T00:00:00",
            "2026-01-19T00:00:00",
            "2026-01-26T00:00:00",
            "2026-02-02T00:00:00",
        ]
    );
}

#[test]
fn expiring_an_iteration_leaves_its_window_end_alone() {
    let slots = four_weeks();
    let resolved = HashMap::new();
    let now = at("2026-02-10T00:00:00");
    let iterations = classify_iterations(&slots[..1], OWED, &resolved, now);
    let deadlines = HashMap::from([(0, at("2026-01-19T00:00:00"))]);
    let expired = expire_unanswered(iterations, &deadlines, now);
    assert_eq!(expired[0].status, IterationStatus::Expired);
    assert_eq!(expired[0].window_end, "2026-01-12T00:00:00");
}
