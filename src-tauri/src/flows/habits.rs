//! Pure Habit-iteration classification.
//!
//! Virtual Habit instances are **derived**, never persisted per iteration: given the recurrence,
//! the reference instant, and which iterations have been completed (the only persisted facts), this
//! module classifies the iteration schedule into `Active` / `Done` / `Lapsed` / `Missed`. It is
//! deliberately free of the database and the calendar — the repository precomputes the concrete
//! iteration windows (`SlotWindow`s) and the completion map, then calls [`classify_iterations`].
//!
//! Windows are half-open `[start, end)` datetimes, so both coarse (day-and-up) and sub-day
//! (part-of-day / exact) Habits classify through the same instant comparisons.
//!
//! Future iterations are never generated (an ellipsis node stands in for them), so callers pass
//! only the slots whose window has started on or before the reference instant.

use std::collections::HashMap;

use chrono::NaiveDateTime;

use super::model::{HabitIteration, IterationStatus};

/// A precomputed iteration window: its ordinal, anchoring scope, and half-open `[start, end)`
/// datetime span. Supplied index-ordered from the Repetition Start.
#[derive(Debug, Clone)]
pub struct SlotWindow {
    /// Zero-based ordinal from the Repetition Start.
    pub index: i64,
    /// Scope anchoring the window's first period.
    pub scope_id: i64,
    /// Inclusive start of the window.
    pub start: NaiveDateTime,
    /// Exclusive end of the window (the window has passed once `now >= end`).
    pub end: NaiveDateTime,
}

/// Parsed Consumption behavior — how a Habit treats unfinished instances as iterations pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Consumption {
    /// Unfinished iterations lapse (Archive-on-exit) once their window ends.
    Destructive,
    /// Unfinished iterations survive and pile up; every started iteration is Active or Done.
    Overlapping,
    /// New iterations are withheld while the open one is unresolved; on completion, `Catchup` runs.
    Blocking(Catchup),
}

/// How a Blocking Habit advances when its open iteration completes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Catchup {
    /// Release every backlogged iteration up to the completion instant at once.
    AllPending,
    /// Release exactly the next iteration.
    Next,
    /// Jump to the iteration containing the completion instant; intermediate ones become Missed.
    Latest,
}

/// The last slot whose window started on or before `at`, or `None` if `at` precedes them all.
fn slot_at(slots: &[SlotWindow], at: NaiveDateTime) -> Option<usize> {
    slots.iter().rposition(|slot| slot.start <= at)
}

fn iteration(slot: &SlotWindow, status: IterationStatus) -> HabitIteration {
    HabitIteration {
        index: slot.index,
        anchor_scope_id: slot.scope_id,
        anchor_date: slot.start.format("%Y-%m-%d").to_string(),
        status,
    }
}

/// Classifies the started iterations of a Habit at `now`.
///
/// `resolved` maps a slot index to the instant that iteration was completed (present iff every
/// instance in it is done). Only completed iterations appear in the map; `now` bounds the schedule
/// (all `slots` are assumed to have started on or before it).
pub fn classify_iterations(
    slots: &[SlotWindow],
    consumption: Consumption,
    resolved: &HashMap<i64, NaiveDateTime>,
    now: NaiveDateTime,
) -> Vec<HabitIteration> {
    match consumption {
        Consumption::Destructive => classify_destructive(slots, resolved, now),
        Consumption::Overlapping => classify_overlapping(slots, resolved),
        Consumption::Blocking(catchup) => classify_blocking(slots, resolved, catchup),
    }
}

/// Bounds a **commitment** Habit's iterations by its Verdict Window.
///
/// A commitment Habit is fixed to Accumulating + Overlapping, so nothing it generates ever lapses
/// on the Consumption path — every started iteration classifies Active until it is answered. That
/// is right while the answer is still owed and wrong forever after: without this, an iteration
/// from a year ago keeps offering its Kept/Broken controls indefinitely. The Verdict Window is the
/// bounding mechanism instead, and this is where it bites.
///
/// `deadlines` maps a slot index to the instant its verdict stops being recordable — the caller
/// computes it, because the arithmetic is calendar arithmetic and this module deliberately has
/// none. An index with no entry is never bounded, which is what a Habit with no Verdict Window
/// set means.
///
/// Only an **Active** iteration expires. A Done one is answered and stays answered; the Verdict
/// Window has never had anything to say about a verdict that was recorded.
pub fn expire_unanswered(
    iterations: Vec<HabitIteration>,
    deadlines: &HashMap<i64, NaiveDateTime>,
    now: NaiveDateTime,
) -> Vec<HabitIteration> {
    iterations
        .into_iter()
        .map(|iteration| {
            let expired = iteration.status == IterationStatus::Active
                && deadlines
                    .get(&iteration.index)
                    .is_some_and(|deadline| now >= *deadline);
            if expired {
                HabitIteration { status: IterationStatus::Expired, ..iteration }
            } else {
                iteration
            }
        })
        .collect()
}

/// Destructive: a passed unfinished iteration is Lapsed; only the current window can be Active.
fn classify_destructive(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDateTime>,
    now: NaiveDateTime,
) -> Vec<HabitIteration> {
    slots
        .iter()
        .map(|slot| {
            let status = if resolved.contains_key(&slot.index) {
                IterationStatus::Done
            } else if slot.end <= now {
                IterationStatus::Lapsed
            } else {
                IterationStatus::Active
            };
            iteration(slot, status)
        })
        .collect()
}

/// Accumulating + Overlapping: every started iteration is Done or Active; nothing lapses.
fn classify_overlapping(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDateTime>,
) -> Vec<HabitIteration> {
    slots
        .iter()
        .map(|slot| {
            let status = if resolved.contains_key(&slot.index) {
                IterationStatus::Done
            } else {
                IterationStatus::Active
            };
            iteration(slot, status)
        })
        .collect()
}

/// Accumulating + Blocking: iterations are withheld beyond the released frontier. `Next` and
/// `Latest` keep a single open iteration; `AllPending` releases the whole backlog to the completion
/// instant. Withheld (future) iterations are omitted — the ellipsis node represents them.
fn classify_blocking(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDateTime>,
    catchup: Catchup,
) -> Vec<HabitIteration> {
    match catchup {
        Catchup::Next => classify_blocking_next(slots, resolved),
        Catchup::Latest => classify_blocking_latest(slots, resolved),
        Catchup::AllPending => classify_blocking_all_pending(slots, resolved),
    }
}

/// Single open iteration; each completion releases exactly the next. The done iterations form a
/// contiguous prefix, followed by one Active iteration (the current open one).
fn classify_blocking_next(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDateTime>,
) -> Vec<HabitIteration> {
    let mut result = Vec::new();
    for slot in slots {
        if resolved.contains_key(&slot.index) {
            result.push(iteration(slot, IterationStatus::Done));
        } else {
            result.push(iteration(slot, IterationStatus::Active));
            break; // The open iteration blocks everything after it.
        }
    }
    result
}

/// Single open iteration; completing it jumps to the slot containing the completion instant, turning
/// the skipped intermediate iterations into Missed.
fn classify_blocking_latest(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDateTime>,
) -> Vec<HabitIteration> {
    let mut result = Vec::new();
    let mut cursor = 0usize;
    while cursor < slots.len() {
        let slot = &slots[cursor];
        let Some(resolved_on) = resolved.get(&slot.index) else {
            result.push(iteration(slot, IterationStatus::Active));
            break; // Open iteration blocks the rest.
        };
        result.push(iteration(slot, IterationStatus::Done));
        // Jump to the slot the completion instant falls in; the gap between becomes Missed.
        let target = slot_at(slots, *resolved_on).unwrap_or(cursor).max(cursor + 1);
        for missed in &slots[cursor + 1..target.min(slots.len())] {
            result.push(iteration(missed, IterationStatus::Missed));
        }
        cursor = target;
    }
    result
}

/// Completing an iteration releases the whole backlog up to that completion instant; released-but-
/// unfinished iterations are Active. Beyond the frontier, blocking resumes (omitted here).
fn classify_blocking_all_pending(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDateTime>,
) -> Vec<HabitIteration> {
    // The frontier reaches the furthest of: any completed slot, and the slot each completion landed
    // in. With no completions it stays at slot 0 (only the first iteration is released).
    let mut frontier = 0usize;
    for slot in slots {
        if let Some(resolved_on) = resolved.get(&slot.index) {
            let landed = slot_at(slots, *resolved_on).unwrap_or(0);
            frontier = frontier.max(slot.index as usize).max(landed);
        }
    }
    slots
        .iter()
        .take(frontier + 1)
        .map(|slot| {
            let status = if resolved.contains_key(&slot.index) {
                IterationStatus::Done
            } else {
                IterationStatus::Active
            };
            iteration(slot, status)
        })
        .collect()
}

#[cfg(test)]
mod tests {
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
}

#[cfg(test)]
mod verdict_window_tests {
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
}
