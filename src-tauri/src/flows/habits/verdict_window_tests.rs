use super::*;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

/// Four contiguous day windows from 2026-01-05: D0..D3, each `[00:00, next 00:00)`.
fn four_days() -> Vec<SlotWindow> {
    (0..4)
        .map(|i| {
            let start = at("2026-01-05T00:00:00") + chrono::Duration::days(i);
            SlotWindow {
                index: i,
                scope_id: 200 + i,
                start,
                end: start + chrono::Duration::days(1),
            }
        })
        .collect()
}

fn statuses(iters: &[HabitIteration]) -> Vec<(i64, IterationStatus)> {
    iters.iter().map(|it| (it.index, it.status)).collect()
}

/// Every iteration answerable until two days past its own window's end.
fn two_days_after(slots: &[SlotWindow]) -> HashMap<i64, NaiveDateTime> {
    slots
        .iter()
        .map(|slot| (slot.index, slot.end + chrono::Duration::days(2)))
        .collect()
}

#[test]
fn an_unanswered_iteration_stays_answerable_right_up_to_its_deadline() {
    let slots = four_days();
    // D0's window shut on the 6th; two days later is the 8th, and it is still 23:59 on the 7th.
    let now = at("2026-01-07T23:59:59");
    let iterations = classify_iterations(&slots, Consumption::Overlapping, &HashMap::new(), now);
    let bounded = expire_unanswered(iterations, &two_days_after(&slots), now);
    assert_eq!(
        statuses(&bounded)[0],
        (0, IterationStatus::Active),
        "last night's verdict can still be recorded this morning"
    );
}

#[test]
fn an_unanswered_iteration_expires_the_instant_its_verdict_window_runs_out() {
    let slots = four_days();
    let now = at("2026-01-08T00:00:00");
    let iterations = classify_iterations(&slots, Consumption::Overlapping, &HashMap::new(), now);
    let bounded = expire_unanswered(iterations, &two_days_after(&slots), now);
    assert_eq!(statuses(&bounded)[0], (0, IterationStatus::Expired));
}

#[test]
fn expiry_runs_per_iteration_rather_than_over_the_habit_as_a_whole() {
    let slots = four_days();
    // The 8th: D0 (shut on the 6th) is out of time, D1 (shut on the 7th) has until the 9th.
    let now = at("2026-01-08T12:00:00");
    let iterations = classify_iterations(&slots, Consumption::Overlapping, &HashMap::new(), now);
    let bounded = expire_unanswered(iterations, &two_days_after(&slots), now);
    assert_eq!(
        statuses(&bounded),
        vec![
            (0, IterationStatus::Expired),
            (1, IterationStatus::Active),
            (2, IterationStatus::Active),
            (3, IterationStatus::Active),
        ]
    );
}

#[test]
fn an_answered_iteration_is_never_expired_however_long_ago_it_was() {
    let slots = four_days();
    let now = at("2027-01-01T00:00:00");
    let resolved = HashMap::from([(0, at("2026-01-05T22:00:00"))]);
    let iterations = classify_iterations(&slots, Consumption::Overlapping, &resolved, now);
    let bounded = expire_unanswered(iterations, &two_days_after(&slots), now);
    assert_eq!(
        statuses(&bounded)[0],
        (0, IterationStatus::Done),
        "the Verdict Window has nothing to say about a verdict that was recorded"
    );
}

#[test]
fn a_habit_with_no_verdict_window_leaves_every_iteration_answerable() {
    let slots = four_days();
    let now = at("2027-01-01T00:00:00");
    let iterations = classify_iterations(&slots, Consumption::Overlapping, &HashMap::new(), now);
    let bounded = expire_unanswered(iterations.clone(), &HashMap::new(), now);
    assert_eq!(
        statuses(&bounded),
        statuses(&iterations),
        "nothing setting a Verdict Window means nothing bounds it, as for a real Commitment"
    );
}

#[test]
fn a_destructive_occurrence_is_past_once_its_own_window_ends() {
    // A Morning band inside an open day: over at noon, hours before the iteration is.
    let morning_end = at("2026-01-05T12:00:00");
    assert!(!instance_is_past(
        Consumption::Destructive,
        IterationStatus::Active,
        morning_end,
        at("2026-01-05T09:00:00"),
    ));
    assert!(instance_is_past(
        Consumption::Destructive,
        IterationStatus::Active,
        morning_end,
        at("2026-01-05T13:00:00"),
    ));
}

#[test]
fn an_accumulating_occurrence_survives_its_own_window() {
    for consumption in
        [Consumption::Overlapping, Consumption::Blocking(Catchup::Next)]
    {
        assert!(
            !instance_is_past(
                consumption,
                IterationStatus::Active,
                at("2026-01-05T12:00:00"),
                at("2026-01-05T23:00:00"),
            ),
            "an accumulating habit's occurrence piles up like its iteration does"
        );
    }
}

#[test]
fn a_lapsed_or_missed_iteration_carries_its_occurrences_with_it() {
    // Window still open by the clock, but the iteration around it is not.
    let later = at("2026-01-09T00:00:00");
    let now = at("2026-01-05T09:00:00");
    for status in [IterationStatus::Lapsed, IterationStatus::Missed] {
        assert!(instance_is_past(Consumption::Overlapping, status, later, now));
    }
}

#[test]
fn an_active_or_done_iteration_leaves_an_unexpired_occurrence_open() {
    let later = at("2026-01-09T00:00:00");
    let now = at("2026-01-05T09:00:00");
    for status in [IterationStatus::Active, IterationStatus::Done, IterationStatus::Expired] {
        assert!(!instance_is_past(Consumption::Destructive, status, later, now));
    }
}
