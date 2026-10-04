//! Derived scope-lifecycle state for scoped Tasks, Goals and Commitments.
//!
//! Three independent axes and one flag, none persisted — everything here is a pure function of an
//! item's effective governance (its own window and On-exit behavior when explicitly scoped,
//! otherwise the nearest scoped ancestor's), its due, its own resolution status, and the reference
//! instant:
//!
//! - [`Timing`] — the item's window position: `Pending` / `Active` / `Lapsed`. Independent of
//!   whether the item is resolved.
//! - [`Resolution`] — how a Lapsed item settled: `Completed` (resolved by the time its window
//!   lapsed) or `Missed` (unresolved, Archive-on-exit). An unresolved **Keep Overdue** item has no
//!   Resolution: its window passing settled nothing, so it stays live. The single-occurrence
//!   analogue of a Window Habit's miss policy (Archive = Archive, Keep Overdue = Owed).
//! - [`Archival`] — the item's effective archived/frozen/live state. Every item may carry its own
//!   manually-set Archival (via [`derive_archival`]'s `stored` parameter): a Goal or Project
//!   through its status (`Frozen` / `Archived`), a Task through its Archival column (**Backlog**,
//!   or **Archived** by hand — which its whole subtree inherits, see
//!   [`crate::tasks::rules::archival`]). A
//!   `Completed` or `Missed` `Resolution` unconditionally forces `Archived` regardless of
//!   `stored`, flagging a conflict when it silently overrides a manually-set `Frozen` **or**
//!   `Backlog`.
//! - **Overdue** ([`derive_overdue`]) — a flag, not a Resolution: the item is unresolved, not
//!   effectively Archived, and `now` is past the end of its **due** ([`effective_due`]). Timing and
//!   the flag are independent: an explicit due ends inside the window, so an Active item can be
//!   Overdue, and an Archive item never is once its lapse has archived it.

use serde::{Deserialize, Serialize};

use chrono::NaiveDateTime;

use crate::scopes::resolve::Bounds;

use crate::tasks::model::{
    CommitmentArchival, DurationSpec, ExpectationArchival, ExpectationStatus, OnScopeExit,
    TaskArchival, Verdict,
};

/// An item's window position relative to `now`. Unscoped items are always `Active`.
///
/// `Deserialize` is derived beside `Serialize` so that a filter fixture can name a window position
/// in the same spelling the wire uses — see [`crate::filters`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
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

/// How a Lapsed item settled. Only defined once [`Timing`] is `Lapsed`, and not always then: an
/// unresolved Keep Overdue item has none.
///
/// **Overdue is not here.** It used to be the third variant, the unresolved Keep-on-exit outcome;
/// it is now a flag of its own ([`derive_overdue`]), because it is judged against the item's due
/// rather than its window, and can hold while the window is still open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Resolution {
    /// Resolved (Task Done / Goal Achieved or Archived) by the time its window lapsed.
    Completed,
    /// Unresolved, and Archive-on-exit: the single-occurrence analogue of a Window + Archive
    /// Habit.
    Missed,
}

/// Derives an item's Resolution. Returns `None` unless `timing` is `Lapsed` — Resolution has no
/// meaning for a Pending or Active item — and `None` for an unresolved item that is not
/// Archive-on-exit: a Keep Overdue item whose window passed is still open work, not a settled
/// outcome, so it keeps no Resolution and stays whatever its stored Archival says.
pub fn derive_resolution(
    timing: Timing,
    resolved: bool,
    on_exit: Option<OnScopeExit>,
) -> Option<Resolution> {
    if timing != Timing::Lapsed {
        return None;
    }
    if resolved {
        return Some(Resolution::Completed);
    }
    match on_exit {
        Some(OnScopeExit::Archive) => Some(Resolution::Missed),
        // Keep Overdue — or, defensively, a scoped item missing its (invariant-guaranteed) on-exit
        // value, which reads as the Keep Overdue default.
        Some(OnScopeExit::Keep) | None => None,
    }
}

/// The due an item is judged **Overdue** against, as a window: its end is the deadline.
///
/// - `explicit` — the due set on the item itself — always wins. Only a Task can carry one.
/// - Otherwise a **backlogged** Task has none: work set aside is not late.
/// - Otherwise the due follows the effective On-exit behavior, inherited with the window: **Keep
///   Overdue** makes the effective Time Scope the due, **Archive** leaves none, and so does having
///   no window at all. A child with no window of its own reads its nearest scoped ancestor's
///   governance, so it derives its due from the inherited window; a child with its own window
///   derives it from that.
///
/// A Habit occurrence's default due is its Habit's clock to decide
/// (`flows::occurrences::default_due`), and is passed here as a Keep Overdue window.
pub fn effective_due(
    explicit: Option<Bounds>,
    governance: Option<(Bounds, OnScopeExit)>,
    backlogged: bool,
) -> Option<Bounds> {
    if explicit.is_some() {
        return explicit;
    }
    if backlogged {
        return None;
    }
    match governance {
        Some((window, OnScopeExit::Keep)) => Some(window),
        Some((_, OnScopeExit::Archive)) | None => None,
    }
}

/// Whether an item is **Overdue** at `now`: it has a due, `now` is at or past the due's end, it is
/// unresolved, and its **effective** Archival is not Archived. A delegated Task can be Overdue —
/// delegation is not archival on this axis — and so can a backlogged one with an explicit due.
pub fn derive_overdue(
    due: Option<Bounds>,
    resolved: bool,
    archival: Archival,
    now: NaiveDateTime,
) -> bool {
    let Some((_, end)) = due else {
        return false;
    };
    !resolved && archival != Archival::Archived && now >= end
}

/// An item's effective archived/frozen/live state.
///
/// `Frozen` and `Backlog` are deliberately distinct variants rather than one state rendered under
/// two names: the database and the wire say which state a node is in, instead of leaving it to be
/// inferred from the node's kind. Neither translates into the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
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
    /// Archived: by hand (a Goal or Project's status, a Task's or Commitment's own archive, or an
    /// ancestor's hand archive inherited), or derived (a forced Resolution, a settled or expired
    /// Commitment, a released wait whose window has passed).
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
    /// Widens a Task's stored state into the shared axis the derivation reads. Total and lossless
    /// in this direction; there is deliberately no way back, since `Frozen` has no Task-side
    /// meaning.
    fn from(archival: TaskArchival) -> Self {
        match archival {
            TaskArchival::Live => Self::Live,
            TaskArchival::Backlog => Self::Backlog,
            TaskArchival::Archived => Self::Archived,
        }
    }
}

/// The result of deriving an item's effective Archival: the value itself, and whether it silently
/// overrode a manually-set `Frozen` or `Backlog`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, schemars::JsonSchema)]
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
/// unfinished. No Resolution forces nothing: a lapsed Keep Overdue item stays whatever `stored`
/// says (or `Live` when nothing is stored).
///
/// `Backlog` loses to a forced `Archived` on exactly the terms `Frozen` does, conflict flag and
/// all. That uniformity is a deliberate choice over letting Backlog win; inverting it later is a
/// one-line change, localised here.
pub fn derive_archival(stored: Option<Archival>, resolution: Option<Resolution>) -> ArchivalResult {
    let forced = matches!(
        resolution,
        Some(Resolution::Completed) | Some(Resolution::Missed)
    );
    if forced {
        ArchivalResult {
            effective: Archival::Archived,
            conflict: is_deliberate(stored),
        }
    } else {
        ArchivalResult {
            effective: stored.unwrap_or(Archival::Live),
            conflict: false,
        }
    }
}

/// One item's fully-derived lifecycle state (Timing/Resolution/Archival and the Overdue flag),
/// without node identity — see [`ItemLifecycle`] for the keyed wire form sent to the frontend.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, schemars::JsonSchema,
)]
pub struct DerivedState {
    /// Window position.
    pub timing: Timing,
    /// Resolution outcome: present only once `timing` is `Lapsed`, and then only when the lapse
    /// settled the item (Completed or Missed).
    pub resolution: Option<Resolution>,
    /// The Overdue flag — see [`derive_overdue`].
    pub overdue: bool,
    /// Effective archived/frozen/live state.
    pub archival: Archival,
    /// True when `archival` silently overrode a manually-set `Frozen` or `Backlog`.
    pub archival_conflict: bool,
}

/// Derives an item's full lifecycle state at `now`. See the module docs for what each axis means;
/// `stored` is the item's own manually-set Archival (a Goal's Frozen/Archived, a Task's Backlog),
/// and `due` its [`effective_due`].
pub fn derive_item_state(
    window: Option<Bounds>,
    on_exit: Option<OnScopeExit>,
    due: Option<Bounds>,
    resolved: bool,
    stored: Option<Archival>,
    now: NaiveDateTime,
) -> DerivedState {
    let timing = derive_timing(window, now);
    let resolution = derive_resolution(timing, resolved, on_exit);
    let ArchivalResult {
        effective,
        conflict,
    } = derive_archival(stored, resolution);
    DerivedState {
        timing,
        resolution,
        overdue: derive_overdue(due, resolved, effective, now),
        archival: effective,
        archival_conflict: conflict,
    }
}

/// One item's fully-derived lifecycle state, keyed by node reference for the frontend.
#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
pub struct ItemLifecycle {
    /// `"task"`, `"goal"`, `"commitment"` or `"expectation"`; `"expectation_check"`,
    /// `"spawned_wait"` and `"spawned_check"` time a wait's next check and a spawned wait.
    pub node_type: String,
    /// The item's id — a stored row's, or a derived one's UUID.
    pub node_id: crate::nodes::id::NodeId,
    /// Window position.
    pub timing: Timing,
    /// Resolution outcome: present only once `timing` is `Lapsed` and the lapse settled the item.
    /// Always absent for a Commitment, whose Resolution axis is replaced by [`Self::verdict`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<Resolution>,
    /// The **Overdue** flag: unresolved, not effectively Archived, and past the end of its due
    /// (see [`derive_overdue`]). Always false for a Commitment. A Habit occurrence's due comes
    /// from its Habit's clock, or its own overlay. Sent only when set, as `resolution` is.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub overdue: bool,
    /// The recorded verdict, present only for a Commitment. Carried on the same wire type as a
    /// Task's Resolution rather than on a parallel one, because it occupies the same slot in the
    /// model — "how did this end" — and every consumer keys all three kinds off one map.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<Verdict>,
    /// Effective archived/frozen/live state.
    pub archival: Archival,
    /// True when `archival` silently overrode a manually-set `Frozen` or `Backlog`.
    pub archival_conflict: bool,
    /// Where the Task's own **Plan** stands at the same instant, on the same axis as [`Self::timing`]
    /// — present only for a Task that has a Plan. Absent for an unplanned Task, a Goal and a
    /// Commitment, none of which is scheduled into anything.
    ///
    /// Only the Task's own Plan counts: a Plan is not inherited the way a Time Scope is. The Start
    /// preset reads it (see [`crate::filters::rules::is_planned_ahead`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_timing: Option<Timing>,
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
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, schemars::JsonSchema,
)]
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
pub(crate) fn advance_by(at: NaiveDateTime, n: i64, kind: &str) -> Option<NaiveDateTime> {
    match kind {
        "day" => at.checked_add_signed(chrono::Duration::try_days(n)?),
        "week" => at.checked_add_signed(chrono::Duration::try_weeks(n)?),
        "month" => at.checked_add_months(chrono::Months::new(u32::try_from(n).ok()?)),
        "season" => {
            at.checked_add_months(chrono::Months::new(u32::try_from(n.checked_mul(3)?).ok()?))
        }
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
/// `stored` is its own archive, set by hand: `Archived` archives it whatever its window and
/// verdict say (Task 269). `window` is its **effective** window — its own Time Scope when explicitly scoped, else the
/// nearest scoped ancestor's. `verdict_window` is likewise the effective one, inherited from the
/// nearest ancestor Commitment that sets it.
///
/// Besides the hand archive, two ways to leave `Live`, and only two:
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
    stored: CommitmentArchival,
    now: NaiveDateTime,
) -> CommitmentState {
    let timing = derive_timing(window, now);
    let settled = verdict.is_resolved() && timing == Timing::Lapsed;
    let expired = !verdict.is_resolved()
        && verdict_deadline(window, verdict_window).is_some_and(|deadline| now >= deadline);
    let by_hand = stored == CommitmentArchival::Archived;
    let archival = if settled || expired || by_hand {
        Archival::Archived
    } else {
        Archival::Live
    };
    CommitmentState {
        timing,
        verdict,
        archival,
    }
}

#[cfg(test)]
mod commitment_tests;

// ===========================================================================
// Expectations
// ===========================================================================
//
// A wait sends one entry for its own Time Scope and one for the day its next check is due, which its
// virtual "check on it" Task reads. Its Archival is its stored archive, or derived once it is
// released and its window has passed (Task 269).

/// Derives a lifecycle entry for a wait, at `now`, over `window` — its Time Scope, or the day its
/// next check is due.
///
/// Timing reads the window as any window is read, and the window is also the wait's due. A window
/// that has passed while the wait is still **pending** flags it **Overdue**, with no Resolution:
/// nothing about a wait archives it for being late, so it stays on screen like a Keep Overdue
/// Task. A released wait has nothing left to be late for.
///
/// **A wait archives itself** once it is **released** — a question's answer releases it — **and**
/// its window has passed, the way a done Task archives once its window lapses; with no window it
/// is archived as soon as it is released (ruled by the user, 2026-10-03). A pending wait never
/// archives itself. The stored hand archive wins either way: it archives a wait whatever its
/// status.
pub fn derive_expectation_state(
    window: Option<Bounds>,
    status: ExpectationStatus,
    stored: ExpectationArchival,
    now: NaiveDateTime,
) -> DerivedState {
    let timing = derive_timing(window, now);
    let released = status == ExpectationStatus::Released;
    let settled = released && (window.is_none() || timing == Timing::Lapsed);
    let archival = if stored == ExpectationArchival::Archived || settled {
        Archival::Archived
    } else {
        Archival::Live
    };
    DerivedState {
        timing,
        resolution: None,
        overdue: derive_overdue(window, released, archival, now),
        archival,
        archival_conflict: false,
    }
}

#[cfg(test)]
mod expectation_tests;
