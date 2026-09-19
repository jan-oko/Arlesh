use super::*;

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
                scope_id: 100 + i,
                start,
                end: start + chrono::Duration::weeks(1),
            }
        })
        .collect()
}

fn statuses(iters: &[HabitIteration]) -> Vec<(i64, IterationStatus)> {
    iters.iter().map(|it| (it.index, it.status)).collect()
}

#[test]
fn destructive_lapses_passed_unfinished_and_keeps_the_current_active() {
    let slots = four_weeks();
    let resolved = HashMap::from([(0, at("2026-01-06T00:00:00"))]); // W0 done, W1/W2 skipped
    let now = at("2026-01-22T00:00:00"); // inside W2 (2026-01-19..26)
    let result = classify_iterations(&slots[..3], Consumption::Destructive, &resolved, now);
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
fn overlapping_keeps_every_unfinished_iteration_active() {
    let slots = four_weeks();
    let resolved = HashMap::from([(1, at("2026-01-14T00:00:00"))]);
    let now = at("2026-01-22T00:00:00");
    let result = classify_iterations(&slots[..3], Consumption::Overlapping, &resolved, now);
    assert_eq!(
        statuses(&result),
        vec![
            (0, IterationStatus::Active),
            (1, IterationStatus::Done),
            (2, IterationStatus::Active),
        ]
    );
}

#[test]
fn blocking_next_shows_one_open_iteration_after_the_done_prefix() {
    let slots = four_weeks();
    let resolved = HashMap::from([(0, at("2026-01-06T00:00:00"))]); // only W0 done
    let now = at("2026-01-22T00:00:00");
    let result = classify_iterations(&slots, Consumption::Blocking(Catchup::Next), &resolved, now);
    // W1 is the single open iteration; W2/W3 are withheld (ellipsis).
    assert_eq!(statuses(&result), vec![(0, IterationStatus::Done), (1, IterationStatus::Active)]);
}

#[test]
fn blocking_latest_marks_skipped_iterations_missed_on_a_late_completion() {
    let slots = four_weeks();
    // W0 completed late — during W2's window (2026-01-19..26).
    let resolved = HashMap::from([(0, at("2026-01-20T00:00:00"))]);
    let now = at("2026-01-22T00:00:00");
    let result = classify_iterations(&slots, Consumption::Blocking(Catchup::Latest), &resolved, now);
    // W0 done; jump to W2 (contains the completion instant) → W1 missed; W2 now open.
    assert_eq!(
        statuses(&result),
        vec![
            (0, IterationStatus::Done),
            (1, IterationStatus::Missed),
            (2, IterationStatus::Active),
        ]
    );
}

#[test]
fn blocking_all_pending_releases_the_backlog_up_to_the_completion_instant() {
    let slots = four_weeks();
    let resolved = HashMap::from([(0, at("2026-01-20T00:00:00"))]); // W0 completed during W2
    let now = at("2026-01-22T00:00:00");
    let result =
        classify_iterations(&slots, Consumption::Blocking(Catchup::AllPending), &resolved, now);
    // Backlog W1, W2 released as pending (Active) rather than missed; W3 stays withheld.
    assert_eq!(
        statuses(&result),
        vec![
            (0, IterationStatus::Done),
            (1, IterationStatus::Active),
            (2, IterationStatus::Active),
        ]
    );
}

#[test]
fn blocking_holds_at_the_first_iteration_until_it_is_done() {
    let slots = four_weeks();
    let resolved = HashMap::new();
    let now = at("2026-01-22T00:00:00");
    for catchup in [Catchup::Next, Catchup::Latest, Catchup::AllPending] {
        let result = classify_iterations(&slots, Consumption::Blocking(catchup), &resolved, now);
        assert_eq!(statuses(&result), vec![(0, IterationStatus::Active)], "catchup {catchup:?}");
    }
}
