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

use super::model::{HabitIteration, InstanceTiming, IterationStatus};

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
        window_end: slot.end.format("%Y-%m-%dT%H:%M:%S").to_string(),
        status,
        // Empty here by construction: resolving an occurrence's window is calendar work, and this
        // module deliberately has none. The repository fills it after classification.
        instances: Vec::new(),
    }
}

/// Where one **occurrence** inside an iteration sits relative to its own half-open
/// `[start, end)` window — the Consumption rule the iteration itself is classified by, applied one
/// level down, with the not-yet-opened case in front of it.
///
/// A Cycle Scope gives an occurrence a window of its own, strictly inside the iteration's. Before
/// that window opens the occurrence is **Pending**: this evening's item, seen at breakfast. It is
/// still produced — which preset shows a Pending occurrence is a rendering decision, and All's
/// contract is that it shows everything — where dropping it here would put it beyond every
/// preset's reach.
///
/// Once the window opens, **Destructive** is what bounds it: a Morning item is Lapsed from noon,
/// hours before the day it sits in ends, which is the whole point of scoping it to the morning.
/// Under **Accumulating** nothing lapses on the way past — an overlapping Habit's unfinished
/// occurrence piles up exactly as its unfinished iteration does, and if a morning routine should
/// vanish at noon, Destructive is what says so.
///
/// An iteration that is itself Lapsed or Missed carries every *started* occurrence in it with it,
/// whatever its Consumption: a Blocking `latest` skip is not a window passing, and nothing under a
/// skipped iteration is still open.
pub fn instance_timing(
    consumption: Consumption,
    iteration_status: IterationStatus,
    window: (NaiveDateTime, NaiveDateTime),
    now: NaiveDateTime,
) -> InstanceTiming {
    let (start, end) = window;
    if start > now {
        return InstanceTiming::Pending;
    }
    if matches!(iteration_status, IterationStatus::Lapsed | IterationStatus::Missed) {
        return InstanceTiming::Lapsed;
    }
    if consumption == Consumption::Destructive && end <= now {
        return InstanceTiming::Lapsed;
    }
    InstanceTiming::Active
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
mod tests;

#[cfg(test)]
mod verdict_window_tests;
