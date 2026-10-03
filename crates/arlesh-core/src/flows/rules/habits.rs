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

use chrono::{NaiveDate, NaiveDateTime};

use crate::flows::model::{HabitIteration, InstanceTiming, IterationStatus, MissPolicy};
use crate::scopes::key::ScopeKey;

/// A precomputed iteration window: its ordinal, anchoring scope, and half-open `[start, end)`
/// datetime span. Supplied index-ordered from the Repetition Start.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct SlotWindow {
    /// Zero-based ordinal from the Repetition Start.
    pub index: i64,
    /// Scope anchoring the window's first period.
    pub scope_id: ScopeKey,
    /// Inclusive start of the window.
    pub start: NaiveDateTime,
    /// Exclusive end of the window (the window has passed once `now >= end`). An Unscoped Interval
    /// Habit's instance has no window; its end is [`UNBOUNDED`], which nothing ever reaches.
    pub end: NaiveDateTime,
}

/// The end of an instance that has **no window** — an Unscoped Interval Habit's: the last second
/// of the year 9999. Past every instant the app will ever be asked about, so nothing lapses by it,
/// and it is never a due, since an Unscoped instance has none. Not `NaiveDateTime::MAX`, whose
/// six-digit signed year would sort *before* today as the text the frontend compares.
pub const UNBOUNDED: NaiveDateTime = match NaiveDate::from_ymd_opt(9999, 12, 31) {
    Some(date) => match date.and_hms_opt(23, 59, 59) {
        Some(instant) => instant,
        None => NaiveDateTime::MAX,
    },
    None => NaiveDateTime::MAX,
};

/// A Habit's **clock**, parsed — what decides when its occurrences fall and what becomes of one
/// left unfinished (`docs/spec/habits.md`, *Clocks*).
///
/// An enum rather than a pair of flags because a miss policy only means anything under a Window
/// clock: an Interval Habit has one open instance and nothing it could miss.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum Clock {
    /// Iterations tile from the Start anchor; the policy says what a passed unfinished one does.
    Window(MissPolicy),
    /// One open instance; the next is placed by the last one's completion.
    Interval,
}

impl Clock {
    /// Whether an occurrence whose own window has passed unfinished lapses (and archives) on the
    /// way past, rather than staying open to be flagged Overdue.
    pub fn lapses_on_exit(self) -> bool {
        self == Self::Window(MissPolicy::Archive)
    }
}

fn iteration(slot: &SlotWindow, status: IterationStatus) -> HabitIteration {
    HabitIteration {
        index: slot.index,
        anchor_scope_id: slot.scope_id,
        anchor_date: slot.start.format("%Y-%m-%d").to_string(),
        window_end: slot.end.format("%Y-%m-%dT%H:%M:%S").to_string(),
        status,
        missed_from: None,
        // Empty here by construction: resolving an occurrence's window is calendar work, and this
        // module deliberately has none. The repository fills it after classification.
        instances: Vec::new(),
    }
}

/// Where one **occurrence** inside an iteration sits relative to its own half-open
/// `[start, end)` window — the rule the iteration itself is classified by, applied one level down,
/// with the not-yet-opened case in front of it.
///
/// A Cycle Scope gives an occurrence a window of its own, strictly inside the iteration's. Before
/// that window opens the occurrence is **Pending**: this evening's item, seen at breakfast. It is
/// still produced — which preset shows a Pending occurrence is a rendering decision, and All's
/// contract is that it shows everything — where dropping it here would put it beyond every
/// preset's reach.
///
/// Once the window opens, **Window + Archive** is what bounds it: a Morning item is Lapsed from
/// noon, hours before the day it sits in ends, which is the whole point of scoping it to the
/// morning. Under every other clock nothing lapses on the way past — an unfinished occurrence stays
/// open and is flagged Overdue past its due instead — and if a morning routine should vanish at
/// noon, Archive is what says so. This reads the window alone, not whether the occurrence is done:
/// a *done* one whose window has passed is Lapsed whatever the clock, which the occurrence's row
/// settles once its state is known (`occurrences::settled_timing`).
///
/// An iteration that is itself Lapsed or Missed carries every *started* occurrence in it with it,
/// whatever its clock: a Missed iteration's work has moved on to the one open now, and nothing
/// under it is still open.
pub fn instance_timing(
    clock: Clock,
    iteration_status: IterationStatus,
    window: (NaiveDateTime, NaiveDateTime),
    now: NaiveDateTime,
) -> InstanceTiming {
    let (start, end) = window;
    if start > now {
        return InstanceTiming::Pending;
    }
    if matches!(
        iteration_status,
        IterationStatus::Lapsed | IterationStatus::Missed
    ) {
        return InstanceTiming::Lapsed;
    }
    if clock.lapses_on_exit() && end <= now {
        return InstanceTiming::Lapsed;
    }
    InstanceTiming::Active
}

/// Classifies the started iterations of a Habit at `now`.
///
/// `resolved` maps a slot index to the instant that iteration was completed (present iff every
/// instance in it is done). Only completed iterations appear in the map; `now` bounds the schedule
/// (all `slots` are assumed to have started on or before it).
///
/// An **Interval** Habit's slots are already its chain — each placed by the completion before it
/// ([`crate::flows::interval_slots`]) — so every one but the last is Done by construction, and it
/// classifies as Window + Owed does: nothing it holds lapses.
pub fn classify_iterations(
    slots: &[SlotWindow],
    clock: Clock,
    resolved: &HashMap<i64, NaiveDateTime>,
    now: NaiveDateTime,
) -> Vec<HabitIteration> {
    match clock {
        Clock::Window(MissPolicy::Archive) => classify_archive(slots, resolved, now),
        Clock::Window(MissPolicy::Owed) | Clock::Interval => classify_owed(slots, resolved),
        Clock::Window(MissPolicy::Overdue) => classify_overdue(slots, resolved),
    }
}

/// Bounds a **commitment** Habit's iterations by its Verdict Window.
///
/// A commitment Habit is fixed to Window + Owed, so nothing it generates ever lapses on the way
/// past its window — every started iteration classifies Active until it is answered. That
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
                HabitIteration {
                    status: IterationStatus::Expired,
                    ..iteration
                }
            } else {
                iteration
            }
        })
        .collect()
}

/// Window + Archive: a passed unfinished iteration is Lapsed; only the current window can be
/// Active.
fn classify_archive(
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

/// Window + Owed (and an Interval chain): every started iteration is Done or Active; nothing
/// lapses.
fn classify_owed(
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

/// Window + Overdue: the **latest started** iteration is the open one — Active until it is done,
/// however long ago its own window passed. Every earlier unfinished iteration is Missed, and the
/// first iteration after a run of Missed ones (the open one, or one done since) carries the run:
/// its `missed_from` names the run's first iteration.
///
/// Which iterations are Missed is read off completions alone, so it is stable: completing the open
/// iteration does not rewrite what came before it, and the done iteration keeps saying which
/// windows it made up for.
fn classify_overdue(
    slots: &[SlotWindow],
    resolved: &HashMap<i64, NaiveDateTime>,
) -> Vec<HabitIteration> {
    let open = slots.len().checked_sub(1);
    let mut run_start: Option<i64> = None;
    let mut result = Vec::with_capacity(slots.len());
    for (position, slot) in slots.iter().enumerate() {
        let done = resolved.contains_key(&slot.index);
        if !done && Some(position) != open {
            run_start.get_or_insert(slot.index);
            result.push(iteration(slot, IterationStatus::Missed));
            continue;
        }
        let status = if done {
            IterationStatus::Done
        } else {
            IterationStatus::Active
        };
        result.push(HabitIteration {
            missed_from: run_start.take(),
            ..iteration(slot, status)
        });
    }
    result
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod verdict_window_tests;
