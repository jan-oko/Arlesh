//! Derived scope-lifecycle state for scoped Tasks and Goals.
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
//! - [`Archival`] — the item's effective archived/frozen/live state. Tasks have no manual archival
//!   concept and are always fully derived from `Resolution`. Goals carry their own manually-set
//!   Archival (via [`derive_archival`]'s `stored` parameter); a `Completed` or `Missed`
//!   `Resolution` unconditionally forces `Archived` regardless of `stored`, flagging a conflict
//!   when it silently overrides a manually-set `Frozen`.

use serde::Serialize;

use chrono::NaiveDateTime;

use crate::scopes::resolve::Bounds;

use super::model::OnScopeExit;

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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Archival {
    /// Actively showing.
    Live,
    /// Manually paused (Goals/Projects only — never derived).
    Frozen,
    /// Archived, either manually (Goals/Projects) or because scope Resolution forced it.
    Archived,
}

/// The result of deriving an item's effective Archival: the value itself, and whether it silently
/// overrode a manually-set `Frozen`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ArchivalResult {
    /// The effective Archival state to display/filter on.
    pub effective: Archival,
    /// True when a manually-set `Frozen` was overridden by a forced-Archived Resolution — worth
    /// surfacing to the user, since it means their explicit choice no longer holds.
    pub conflict: bool,
}

/// Derives an item's effective Archival. `stored` is the item's own manually-set Archival, if it
/// has one (`None` for Tasks, which have no manual archival concept and are always fully derived).
/// A `Completed` or `Missed` [`Resolution`] unconditionally forces `Archived`, regardless of
/// `stored` — scope resolution always wins for a scoped, lapsed item. `Overdue` never forces
/// anything: the item stays whatever `stored` says (or `Live` when nothing is stored).
pub fn derive_archival(stored: Option<Archival>, resolution: Option<Resolution>) -> ArchivalResult {
    let forced = matches!(resolution, Some(Resolution::Completed) | Some(Resolution::Missed));
    if forced {
        ArchivalResult { effective: Archival::Archived, conflict: stored == Some(Archival::Frozen) }
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
    /// True when `archival` silently overrode a manually-set `Frozen`.
    pub archival_conflict: bool,
}

/// Derives an item's full lifecycle state at `now`. See the module docs for what each axis means;
/// `stored` is the item's own manually-set Archival (`None` for Tasks).
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
    /// `"task"` or `"goal"`.
    pub node_type: String,
    /// The item's id.
    pub node_id: i64,
    /// Window position.
    pub timing: Timing,
    /// Resolution outcome, present iff `timing` is `Lapsed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<Resolution>,
    /// Effective archived/frozen/live state.
    pub archival: Archival,
    /// True when `archival` silently overrode a manually-set `Frozen`.
    pub archival_conflict: bool,
}

#[cfg(test)]
#[cfg_attr(coverage_nightly, coverage(off))]
mod tests {
    use super::*;

    fn at(iso: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
    }

    fn window() -> Bounds {
        (at("2026-01-05T00:00:00"), at("2026-01-12T00:00:00"))
    }

    // --- Timing ---

    #[test]
    fn unscoped_is_always_active() {
        assert_eq!(derive_timing(None, at("2030-01-01T00:00:00")), Timing::Active);
    }

    #[test]
    fn before_window_start_is_pending() {
        assert_eq!(derive_timing(Some(window()), at("2026-01-01T00:00:00")), Timing::Pending);
    }

    #[test]
    fn within_window_is_active() {
        assert_eq!(derive_timing(Some(window()), at("2026-01-08T09:00:00")), Timing::Active);
    }

    #[test]
    fn at_or_after_window_end_is_lapsed() {
        assert_eq!(derive_timing(Some(window()), at("2026-01-12T00:00:00")), Timing::Lapsed);
        assert_eq!(derive_timing(Some(window()), at("2026-01-20T00:00:00")), Timing::Lapsed);
    }

    // --- Resolution ---

    #[test]
    fn resolution_is_none_while_pending_or_active() {
        assert_eq!(derive_resolution(Timing::Pending, false, Some(OnScopeExit::Archive)), None);
        assert_eq!(derive_resolution(Timing::Active, false, Some(OnScopeExit::Archive)), None);
    }

    #[test]
    fn lapsed_and_resolved_is_completed_regardless_of_on_exit() {
        assert_eq!(derive_resolution(Timing::Lapsed, true, Some(OnScopeExit::Archive)), Some(Resolution::Completed));
        assert_eq!(derive_resolution(Timing::Lapsed, true, Some(OnScopeExit::Keep)), Some(Resolution::Completed));
        assert_eq!(derive_resolution(Timing::Lapsed, true, None), Some(Resolution::Completed));
    }

    #[test]
    fn lapsed_unresolved_archive_on_exit_is_missed() {
        assert_eq!(derive_resolution(Timing::Lapsed, false, Some(OnScopeExit::Archive)), Some(Resolution::Missed));
    }

    #[test]
    fn lapsed_unresolved_keep_on_exit_is_overdue() {
        assert_eq!(derive_resolution(Timing::Lapsed, false, Some(OnScopeExit::Keep)), Some(Resolution::Overdue));
    }

    #[test]
    fn lapsed_unresolved_missing_on_exit_defensively_falls_back_to_overdue() {
        assert_eq!(derive_resolution(Timing::Lapsed, false, None), Some(Resolution::Overdue));
    }

    // --- Archival ---

    #[test]
    fn no_forcing_resolution_keeps_the_stored_value() {
        assert_eq!(derive_archival(Some(Archival::Frozen), None).effective, Archival::Frozen);
        assert_eq!(derive_archival(Some(Archival::Frozen), Some(Resolution::Overdue)).effective, Archival::Frozen);
        assert_eq!(derive_archival(Some(Archival::Archived), None).effective, Archival::Archived);
    }

    #[test]
    fn nothing_stored_and_no_forcing_defaults_to_live() {
        let result = derive_archival(None, None);
        assert_eq!(result.effective, Archival::Live);
        assert!(!result.conflict);
    }

    #[test]
    fn overdue_never_forces_archival() {
        let result = derive_archival(Some(Archival::Live), Some(Resolution::Overdue));
        assert_eq!(result.effective, Archival::Live);
        assert!(!result.conflict);
    }

    #[test]
    fn completed_forces_archival_for_a_task_with_nothing_stored() {
        let result = derive_archival(None, Some(Resolution::Completed));
        assert_eq!(result.effective, Archival::Archived);
        assert!(!result.conflict); // nothing manual to conflict with
    }

    #[test]
    fn missed_forces_archival_regardless_of_stored_value() {
        assert_eq!(derive_archival(Some(Archival::Live), Some(Resolution::Missed)).effective, Archival::Archived);
        assert_eq!(derive_archival(Some(Archival::Archived), Some(Resolution::Missed)).effective, Archival::Archived);
    }

    #[test]
    fn forcing_archival_over_a_manually_frozen_item_flags_a_conflict() {
        let result = derive_archival(Some(Archival::Frozen), Some(Resolution::Completed));
        assert_eq!(result.effective, Archival::Archived);
        assert!(result.conflict);
    }

    #[test]
    fn forcing_archival_over_live_or_already_archived_is_not_a_conflict() {
        assert!(!derive_archival(Some(Archival::Live), Some(Resolution::Completed)).conflict);
        assert!(!derive_archival(Some(Archival::Archived), Some(Resolution::Missed)).conflict);
        assert!(!derive_archival(None, Some(Resolution::Completed)).conflict);
    }

    // --- derive_item_state (integration of all three axes) ---

    #[test]
    fn a_done_item_past_its_window_is_now_archived_not_silently_active() {
        // This is the behavior this module was rewritten to fix: a resolved item used to always
        // report Active, even once its window had fully passed.
        let state = derive_item_state(Some(window()), Some(OnScopeExit::Archive), true, None, at("2026-02-01T00:00:00"));
        assert_eq!(state.timing, Timing::Lapsed);
        assert_eq!(state.resolution, Some(Resolution::Completed));
        assert_eq!(state.archival, Archival::Archived);
        assert!(!state.archival_conflict);
    }

    #[test]
    fn a_resolved_item_within_its_window_is_still_just_active() {
        let state = derive_item_state(Some(window()), Some(OnScopeExit::Archive), true, None, at("2026-01-08T00:00:00"));
        assert_eq!(state.timing, Timing::Active);
        assert_eq!(state.resolution, None);
        assert_eq!(state.archival, Archival::Live);
    }

    #[test]
    fn an_unscoped_item_is_never_forced_into_anything() {
        let state = derive_item_state(None, None, false, Some(Archival::Frozen), at("2030-01-01T00:00:00"));
        assert_eq!(state.timing, Timing::Active);
        assert_eq!(state.resolution, None);
        assert_eq!(state.archival, Archival::Frozen);
        assert!(!state.archival_conflict);
    }

    #[test]
    fn passed_keep_item_is_overdue_and_stays_live() {
        let state = derive_item_state(Some(window()), Some(OnScopeExit::Keep), false, Some(Archival::Live), at("2026-01-20T00:00:00"));
        assert_eq!(state.resolution, Some(Resolution::Overdue));
        assert_eq!(state.archival, Archival::Live);
    }

    #[test]
    fn passed_archive_item_is_missed_and_becomes_archived() {
        let state = derive_item_state(Some(window()), Some(OnScopeExit::Archive), false, Some(Archival::Live), at("2026-01-20T00:00:00"));
        assert_eq!(state.resolution, Some(Resolution::Missed));
        assert_eq!(state.archival, Archival::Archived);
    }

    #[test]
    fn the_half_open_end_is_already_passed() {
        // now == end: the window [start, end) no longer contains `now`.
        let state = derive_item_state(Some(window()), Some(OnScopeExit::Archive), false, None, at("2026-01-12T00:00:00"));
        assert_eq!(state.timing, Timing::Lapsed);
        assert_eq!(state.resolution, Some(Resolution::Missed));
    }
}
