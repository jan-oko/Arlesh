//! Derived scope-lifecycle state for scoped Tasks, Goals and Commitments.
//!
//! Three independent axes, none persisted — everything here is a pure function of an item's
//! effective governance (its own window and On-exit behavior when explicitly scoped, otherwise the
//! nearest scoped ancestor's), its own resolution status, and the reference instant:
//!
//! - [`Timing`] — the item's window position: `Pending` / `Active` / `Lapsed`. Independent of
//!   whether the item is resolved.
//! - [`Resolution`] — only meaningful once `Timing` is `Lapsed`: `Completed` (resolved by the time
//!   its window lapsed), `Missed` (unresolved, Archive-on-exit), or `Overdue` (unresolved,
//!   Keep-on-exit). The single-occurrence analogue of a Habit's Consumption root (Archive =
//!   Destructive, Keep = Accumulating).
//! - [`Archival`] — the item's effective archived/frozen/live state. Every item may carry its own
//!   manually-set Archival (via [`derive_archival`]'s `stored` parameter): a Goal or Project
//!   through its status (`Frozen` / `Archived`), a Task through its **Backlog** column. A
//!   `Completed` or `Missed` `Resolution` unconditionally forces `Archived` regardless of
//!   `stored`, flagging a conflict when it silently overrides a manually-set `Frozen` **or**
//!   `Backlog`.

use serde::{Deserialize, Serialize};

use chrono::NaiveDateTime;

use crate::scopes::resolve::Bounds;

use super::model::{DurationSpec, OnScopeExit, TaskArchival, Verdict};

/// An item's window position relative to `now`. Unscoped items are always `Active`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Timing {
    /// Window has not started yet.
    Pending,
    /// Within the window, or unscoped.
    Active,
    /// Window has fully passed (`now >= end`).
    Lapsed,
}

/// Derives an item's Timing at `now`. `window` is the item's effective window (its own when
/// explicitly scoped, else the nearest scoped ancestor's, or `None` when unscoped).
pub fn derive_timing(window: Option<Bounds>, now: NaiveDateTime) -> Timing {
    let Some((start, end)) = window else {
        return Timing::Active;
    };
    if now < start {
        Timing::Pending
    } else if now < end {
        Timing::Active
    } else {
        Timing::Lapsed
    }
}

/// How a Lapsed item relates to its own completion. Only defined once [`Timing`] is `Lapsed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Resolution {
    /// Resolved (Task Done / Goal Achieved or Archived) by the time its window lapsed.
    Completed,
    /// Unresolved, and Archive-on-exit: the single-occurrence analogue of a Destructive Habit.
    Missed,
    /// Unresolved, and Keep-on-exit: the single-occurrence analogue of an Accumulating Habit.
    Overdue,
}

/// Derives an item's Resolution. Returns `None` unless `timing` is `Lapsed` — Resolution has no
/// meaning for a Pending or Active item.
pub fn derive_resolution(timing: Timing, resolved: bool, on_exit: Option<OnScopeExit>) -> Option<Resolution> {
    if timing != Timing::Lapsed {
        return None;
    }
    if resolved {
        return Some(Resolution::Completed);
    }
    Some(match on_exit {
        Some(OnScopeExit::Archive) => Resolution::Missed,
        // Keep — or, defensively, a scoped item missing its (invariant-guaranteed) on-exit value.
        _ => Resolution::Overdue,
    })
}

/// An item's effective archived/frozen/live state.
///
/// `Frozen` and `Backlog` are deliberately distinct variants rather than one state rendered under
/// two names: the database and the wire say which state a node is in, instead of leaving it to be
/// inferred from the node's kind. Neither translates into the other — a Frozen Goal retyped to a
/// Task arrives as an ordinary Live one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Archival {
    /// Actively showing.
    Live,
    /// Manually paused (Goals/Projects only — never derived).
    Frozen,
    /// Manually set aside (Tasks only — never derived). Hidden from Plan and Start together with
    /// everything beneath it, shown under All, and still carrying its own status: a backlogged
    /// task that was in progress says so when it is pulled back.
    Backlog,
    /// Archived, either manually (Goals/Projects) or because scope Resolution forced it.
    Archived,
}

impl Archival {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Frozen => "frozen",
            Self::Backlog => "backlog",
            Self::Archived => "archived",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "live" => Some(Self::Live),
            "frozen" => Some(Self::Frozen),
            "backlog" => Some(Self::Backlog),
            "archived" => Some(Self::Archived),
            _ => None,
        }
    }
}

impl From<TaskArchival> for Archival {
    /// Widens a Task's two-variant stored state into the shared axis the derivation reads. Total
    /// and lossless in this direction; there is deliberately no way back, since `Frozen` and
    /// `Archived` have no Task-side meaning.
    fn from(archival: TaskArchival) -> Self {
        match archival {
            TaskArchival::Live => Self::Live,
            TaskArchival::Backlog => Self::Backlog,
        }
    }
}

/// The result of deriving an item's effective Archival: the value itself, and whether it silently
/// overrode a manually-set `Frozen` or `Backlog`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ArchivalResult {
    /// The effective Archival state to display/filter on.
    pub effective: Archival,
    /// True when a manually-set `Frozen` or `Backlog` was overridden by a forced-Archived
    /// Resolution — worth surfacing to the user, since it means their explicit choice no longer
    /// holds.
    pub conflict: bool,
}

/// Whether `stored` is a state the user deliberately put the item into, and so one a forced
/// `Archived` silently overrides. `Live` is the absence of a choice and `Archived` is already the
/// outcome being forced, so neither conflicts with anything.
fn is_deliberate(stored: Option<Archival>) -> bool {
    matches!(stored, Some(Archival::Frozen) | Some(Archival::Backlog))
}

/// Derives an item's effective Archival. `stored` is the item's own manually-set Archival, if it
/// has one — `Frozen`/`Archived` for a Goal or Project, `Backlog` for a Task, `None` for anything
/// with no archival column at all. A `Completed` or `Missed` [`Resolution`] unconditionally forces
/// `Archived`, regardless of `stored` — scope resolution always wins for a scoped, lapsed item, so
/// backlogging a scoped Task does **not** exempt it from lapsing Missed when its window closes
/// unfinished. `Overdue` never forces anything: the item stays whatever `stored` says (or `Live`
/// when nothing is stored).
///
/// `Backlog` loses to a forced `Archived` on exactly the terms `Frozen` does, conflict flag and
/// all. That uniformity is a deliberate choice over letting Backlog win; inverting it later is a
/// one-line change, localised here.
pub fn derive_archival(stored: Option<Archival>, resolution: Option<Resolution>) -> ArchivalResult {
    let forced = matches!(resolution, Some(Resolution::Completed) | Some(Resolution::Missed));
    if forced {
        ArchivalResult { effective: Archival::Archived, conflict: is_deliberate(stored) }
    } else {
        ArchivalResult { effective: stored.unwrap_or(Archival::Live), conflict: false }
    }
}

/// One item's fully-derived lifecycle state (Timing/Resolution/Archival), without node identity —
/// see [`ItemLifecycle`] for the keyed wire form sent to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DerivedState {
    /// Window position.
    pub timing: Timing,
    /// Resolution outcome, present iff `timing` is `Lapsed`.
    pub resolution: Option<Resolution>,
    /// Effective archived/frozen/live state.
    pub archival: Archival,
    /// True when `archival` silently overrode a manually-set `Frozen` or `Backlog`.
    pub archival_conflict: bool,
}

/// Derives an item's full lifecycle state at `now`. See the module docs for what each axis means;
/// `stored` is the item's own manually-set Archival (a Goal's Frozen/Archived, a Task's Backlog).
pub fn derive_item_state(
    window: Option<Bounds>,
    on_exit: Option<OnScopeExit>,
    resolved: bool,
    stored: Option<Archival>,
    now: NaiveDateTime,
) -> DerivedState {
    let timing = derive_timing(window, now);
    let resolution = derive_resolution(timing, resolved, on_exit);
    let ArchivalResult { effective, conflict } = derive_archival(stored, resolution);
    DerivedState { timing, resolution, archival: effective, archival_conflict: conflict }
}

/// One item's fully-derived lifecycle state, keyed by node reference for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct ItemLifecycle {
    /// `"task"`, `"goal"` or `"commitment"`.
    pub node_type: String,
    /// The item's id.
    pub node_id: i64,
    /// Window position.
    pub timing: Timing,
    /// Resolution outcome, present iff `timing` is `Lapsed`. Always absent for a Commitment,
    /// whose Resolution axis is replaced by [`Self::verdict`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<Resolution>,
    /// The recorded verdict, present only for a Commitment. Carried on the same wire type as a
    /// Task's Resolution rather than on a parallel one, because it occupies the same slot in the
    /// model — "how did this end" — and every consumer keys all three kinds off one map.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<Verdict>,
    /// Effective archived/frozen/live state.
    pub archival: Archival,
    /// True when `archival` silently overrode a manually-set `Frozen` or `Backlog`.
    pub archival_conflict: bool,
}

#[cfg(test)]
mod tests;

// ===========================================================================
// Commitments
// ===========================================================================
//
// A Commitment shares the Timing axis with everything else — a window either has not started, is
// running, or has passed — and replaces the other two. Its Resolution is the recorded
// [`Verdict`], which nothing here derives; its Archival is decided by the **Verdict Window**,
// which is the only automatic state change in the kind, and which moves Archival rather than the
// Verdict.

/// A Commitment's fully-derived lifecycle state at some instant.
///
/// `verdict` is passed straight back out rather than computed. It is a field of the value only so
/// that callers have one place to read the whole state from; see [`Verdict`] for why deriving it
/// is the one thing this module must not do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommitmentState {
    /// Window position.
    pub timing: Timing,
    /// The recorded verdict, unchanged.
    pub verdict: Verdict,
    /// Effective archived/live state.
    pub archival: Archival,
}

/// Advances `at` by `n` units of a scope `kind`, or `None` for an unrecognised kind or a
/// calendar overflow.
///
/// The four coarse Spans only. A Verdict Window counted in `part` or `exact` — the two sub-day
/// scope kinds — has no meaning as a *count*, so such a value reads as no window at all rather
/// than as some silently substituted number of hours.
fn advance_by(at: NaiveDateTime, n: i64, kind: &str) -> Option<NaiveDateTime> {
    match kind {
        "day" => at.checked_add_signed(chrono::Duration::try_days(n)?),
        "week" => at.checked_add_signed(chrono::Duration::try_weeks(n)?),
        "month" => at.checked_add_months(chrono::Months::new(u32::try_from(n).ok()?)),
        "season" => at.checked_add_months(chrono::Months::new(u32::try_from(n.checked_mul(3)?).ok()?)),
        _ => None,
    }
}

/// The instant an unresolved Commitment stops being answerable: the end of its window plus its
/// **Verdict Window**, a count of any scope kind.
///
/// `None` when nothing bounds it — no window, no Verdict Window, or a Duration this calendar
/// cannot express. An unbounded unresolved Commitment simply stays Live, which is the honest
/// reading of "nobody has said how long they have to answer".
///
/// The Duration's kind is deliberately independent of the commitment's own scope kind, so a
/// monthly commitment can be answerable for two days and a daily one for a week.
pub fn verdict_deadline(
    window: Option<Bounds>,
    verdict_window: Option<&DurationSpec>,
) -> Option<NaiveDateTime> {
    let (_, end) = window?;
    let duration = verdict_window?;
    advance_by(end, duration.n, &duration.kind)
}

/// Derives a Commitment's lifecycle state at `now`.
///
/// `window` is its **effective** window — its own Time Scope when explicitly scoped, else the
/// nearest scoped ancestor's. `verdict_window` is likewise the effective one, inherited from the
/// nearest ancestor Commitment that sets it.
///
/// Two ways to leave `Live`, and only two:
///
/// * a verdict has been recorded **and** the window has passed — the commitment is settled, and
///   there is nothing left to say about it;
/// * no verdict has been recorded and the Verdict Window has run out — the chance to say has
///   gone. The Verdict stays `Unresolved`, because not having judged something is itself part of
///   the record; only Archival moves.
///
/// Note the asymmetry with a Task, and that it is the whole point of the kind: a Task unfinished
/// at window close may be **Missed**, whereas nothing here ever concludes that a Commitment was
/// Broken.
pub fn derive_commitment_state(
    window: Option<Bounds>,
    verdict: Verdict,
    verdict_window: Option<&DurationSpec>,
    now: NaiveDateTime,
) -> CommitmentState {
    let timing = derive_timing(window, now);
    let settled = verdict.is_resolved() && timing == Timing::Lapsed;
    let expired = !verdict.is_resolved()
        && verdict_deadline(window, verdict_window).is_some_and(|deadline| now >= deadline);
    let archival = if settled || expired { Archival::Archived } else { Archival::Live };
    CommitmentState { timing, verdict, archival }
}

#[cfg(test)]
mod commitment_tests;
