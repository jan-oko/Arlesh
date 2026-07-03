//! Pure Habit-iteration classification.
//!
//! Virtual Habit instances are **derived**, never persisted per iteration: given the recurrence,
//! the reference day, and which iterations have been completed (the only persisted facts), this
//! module classifies the iteration schedule into `Active` / `Done` / `Lapsed` / `Missed`. It is
//! deliberately free of the database and the calendar — the repository precomputes the concrete
//! iteration windows (`SlotWindow`s) and the completion map, then calls [`classify_iterations`].
//!
//! Future iterations are never generated (an ellipsis node stands in for them), so callers pass
//! only the slots whose window has started on or before the reference day.

use std::collections::HashMap;

use chrono::NaiveDate;

use super::model::{HabitIteration, IterationStatus};

/// A precomputed iteration window: its ordinal, anchoring scope, and half-open-ish `[start, end]`
/// day span (both inclusive days). Supplied index-ordered from the Repetition Start.
#[derive(Debug, Clone)]
pub struct SlotWindow {
    /// Zero-based ordinal from the Repetition Start.
    pub index: i64,
    /// Scope anchoring the window's first period.
    pub scope_id: i64,
    /// First day of the window.
    pub start: NaiveDate,
    /// Last day of the window.
    pub end: NaiveDate,
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
    /// Release every backlogged iteration up to the completion day at once.
    AllPending,
    /// Release exactly the next iteration.
    Next,
    /// Jump to the iteration containing the completion day; intermediate ones become Missed.
    Latest,
}

/// The last slot whose window started on or before `day`, or `None` if `day` precedes them all.
fn slot_at(slots: &[SlotWindow], day: NaiveDate) -> Option<usize> {
    slots.iter().rposition(|slot| slot.start <= day)
}

fn iteration(slot: &SlotWindow, status: IterationStatus) -> HabitIteration {
    HabitIteration {
        index: slot.index,
        anchor_scope_id: slot.scope_id,
        anchor_date: slot.start.format("%Y-%m-%d").to_string(),
        status,
    }
}

/// Classifies the started iterations of a Habit on `today`.
///
/// `resolved` maps a slot index to the day that iteration was completed (present iff every instance
/// in it is done). Only completed iterations appear in the map; `today` bounds the schedule (all
/// `slots` are assumed to have started on or before it).
pub fn classify_iterations(
    slots: &[SlotWindow],
    consumption: Consumption,
    resolved: &HashMap<i64, NaiveDate>,
    today: NaiveDate,
) -> Vec<HabitIteration> {
    match consumption {
        Consumption::Destructive => classify_destructive(slots, resolved, today),
        Consumption::Overlapping => classify_overlapping(slots, resolved),
        Consumption::Blocking(catchup) => classify_blocking(slots, resolved, catchup),
    }
}

/// Destructive: a passed unfinished iteration is Lapsed; only the current window can be Active.
fn classify_destructive(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDate>,
    today: NaiveDate,
) -> Vec<HabitIteration> {
    slots
        .iter()
        .map(|slot| {
            let status = if resolved.contains_key(&slot.index) {
                IterationStatus::Done
            } else if slot.end < today {
                IterationStatus::Lapsed
            } else {
                IterationStatus::Active
            };
            iteration(slot, status)
        })
        .collect()
}

/// Accumulating + Overlapping: every started iteration is Done or Active; nothing is archived.
fn classify_overlapping(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDate>,
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
/// day. Withheld (future) iterations are omitted — the ellipsis node represents them.
fn classify_blocking(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDate>,
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
    resolved: &HashMap<i64, NaiveDate>,
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

/// Single open iteration; completing it jumps to the slot containing the completion day, turning the
/// skipped intermediate iterations into Missed.
fn classify_blocking_latest(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDate>,
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
        // Jump to the slot the completion day falls in; the gap between becomes Missed.
        let target = slot_at(slots, *resolved_on).unwrap_or(cursor).max(cursor + 1);
        for missed in &slots[cursor + 1..target.min(slots.len())] {
            result.push(iteration(missed, IterationStatus::Missed));
        }
        cursor = target;
    }
    result
}

/// Completing an iteration releases the whole backlog up to that completion day; released-but-
/// unfinished iterations are Active. Beyond the frontier, blocking resumes (omitted here).
fn classify_blocking_all_pending(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDate>,
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

    fn day(iso: &str) -> NaiveDate {
        NaiveDate::parse_from_str(iso, "%Y-%m-%d").unwrap()
    }

    /// Four contiguous week windows starting 2026-01-05 (Mon): W0..W3, scope ids 100..103.
    fn four_weeks() -> Vec<SlotWindow> {
        (0..4)
            .map(|i| {
                let start = day("2026-01-05") + chrono::Duration::weeks(i);
                SlotWindow { index: i, scope_id: 100 + i, start, end: start + chrono::Duration::days(6) }
            })
            .collect()
    }

    fn statuses(iters: &[HabitIteration]) -> Vec<(i64, IterationStatus)> {
        iters.iter().map(|it| (it.index, it.status)).collect()
    }

    #[test]
    fn destructive_lapses_passed_unfinished_and_keeps_the_current_active() {
        let slots = four_weeks();
        let resolved = HashMap::from([(0, day("2026-01-06"))]); // W0 done, W1/W2 skipped
        let today = day("2026-01-22"); // inside W2 (2026-01-19..25)
        let result = classify_iterations(&slots[..3], Consumption::Destructive, &resolved, today);
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
        let resolved = HashMap::from([(1, day("2026-01-14"))]);
        let today = day("2026-01-22");
        let result = classify_iterations(&slots[..3], Consumption::Overlapping, &resolved, today);
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
        let resolved = HashMap::from([(0, day("2026-01-06"))]); // only W0 done
        let today = day("2026-01-22");
        let result = classify_iterations(&slots, Consumption::Blocking(Catchup::Next), &resolved, today);
        // W1 is the single open iteration; W2/W3 are withheld (ellipsis).
        assert_eq!(statuses(&result), vec![(0, IterationStatus::Done), (1, IterationStatus::Active)]);
    }

    #[test]
    fn blocking_latest_marks_skipped_iterations_missed_on_a_late_completion() {
        let slots = four_weeks();
        // W0 completed late — during W2's window (2026-01-19..25).
        let resolved = HashMap::from([(0, day("2026-01-20"))]);
        let today = day("2026-01-22");
        let result = classify_iterations(&slots, Consumption::Blocking(Catchup::Latest), &resolved, today);
        // W0 done; jump to W2 (contains the completion day) → W1 missed; W2 now open.
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
    fn blocking_all_pending_releases_the_backlog_up_to_the_completion_day() {
        let slots = four_weeks();
        let resolved = HashMap::from([(0, day("2026-01-20"))]); // W0 completed during W2
        let today = day("2026-01-22");
        let result = classify_iterations(&slots, Consumption::Blocking(Catchup::AllPending), &resolved, today);
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
        let today = day("2026-01-22");
        for catchup in [Catchup::Next, Catchup::Latest, Catchup::AllPending] {
            let result = classify_iterations(&slots, Consumption::Blocking(catchup), &resolved, today);
            assert_eq!(statuses(&result), vec![(0, IterationStatus::Active)], "catchup {catchup:?}");
        }
    }
}
