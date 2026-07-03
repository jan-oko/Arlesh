//! Derived scope-lifecycle state for scoped Tasks and Goals.
//!
//! Overdue and Lapsed are **derived**, never persisted: given an item's effective governance (its
//! own window and On-exit behavior when explicitly scoped, otherwise the nearest scoped ancestor's),
//! whether it is already resolved, and the reference instant, this classifies it. It is the single-
//! occurrence analogue of the Habit Consumption root (Archive = Destructive, Keep = Accumulating).

use serde::Serialize;

use chrono::NaiveDateTime;

use crate::scopes::resolve::Bounds;

use super::model::OnScopeExit;

/// The derived state of a scoped item relative to `now`. Never stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeLifecycle {
    /// Within (or before) its window, or unscoped, or already resolved.
    Active,
    /// A Keep-on-exit item whose window has fully passed while still unresolved.
    Overdue,
    /// An Archive-on-exit item whose window has fully passed while still unresolved.
    Lapsed,
}

/// A single item's derived scope lifecycle, keyed by node reference for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct ItemLifecycle {
    /// `"task"` or `"goal"`.
    pub node_type: String,
    /// The item's id.
    pub node_id: i64,
    /// The derived state at the reference instant.
    pub state: ScopeLifecycle,
}

/// Derives an item's scope lifecycle at `now`.
///
/// `window` and `on_exit` are the item's **effective** governance: its own when explicitly scoped,
/// else the nearest scoped ancestor's, or `None` when nothing above it is scoped (Unscoped —
/// always Active). `resolved` is true when the item sits in a terminal status (a Task that is Done,
/// a Goal that is Achieved or Archived), which is never flagged. Windows are half-open `[start,
/// end)`, so a window has fully passed once `now >= end`.
pub fn derive_scope_lifecycle(
    window: Option<Bounds>,
    on_exit: Option<OnScopeExit>,
    resolved: bool,
    now: NaiveDateTime,
) -> ScopeLifecycle {
    if resolved {
        return ScopeLifecycle::Active;
    }
    let Some((_, end)) = window else {
        return ScopeLifecycle::Active;
    };
    if now < end {
        return ScopeLifecycle::Active;
    }
    match on_exit {
        Some(OnScopeExit::Archive) => ScopeLifecycle::Lapsed,
        // Keep — or, defensively, a scoped item missing its (invariant-guaranteed) on-exit value.
        _ => ScopeLifecycle::Overdue,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(iso: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
    }

    fn window() -> Bounds {
        (at("2026-01-05T00:00:00"), at("2026-01-12T00:00:00"))
    }

    #[test]
    fn unscoped_item_is_always_active() {
        let after = at("2030-01-01T00:00:00");
        assert_eq!(
            derive_scope_lifecycle(None, None, false, after),
            ScopeLifecycle::Active
        );
    }

    #[test]
    fn resolved_item_never_flags_even_when_its_window_has_passed() {
        let after = at("2026-02-01T00:00:00");
        assert_eq!(
            derive_scope_lifecycle(Some(window()), Some(OnScopeExit::Archive), true, after),
            ScopeLifecycle::Active
        );
    }

    #[test]
    fn within_window_is_active() {
        let inside = at("2026-01-08T09:00:00");
        assert_eq!(
            derive_scope_lifecycle(Some(window()), Some(OnScopeExit::Keep), false, inside),
            ScopeLifecycle::Active
        );
    }

    #[test]
    fn passed_keep_item_is_overdue() {
        let after = at("2026-01-12T00:00:01");
        assert_eq!(
            derive_scope_lifecycle(Some(window()), Some(OnScopeExit::Keep), false, after),
            ScopeLifecycle::Overdue
        );
    }

    #[test]
    fn passed_archive_item_lapses() {
        let after = at("2026-01-20T00:00:00");
        assert_eq!(
            derive_scope_lifecycle(Some(window()), Some(OnScopeExit::Archive), false, after),
            ScopeLifecycle::Lapsed
        );
    }

    #[test]
    fn the_half_open_end_is_already_passed() {
        // now == end: the window [start, end) no longer contains `now`.
        let boundary = at("2026-01-12T00:00:00");
        assert_eq!(
            derive_scope_lifecycle(Some(window()), Some(OnScopeExit::Archive), false, boundary),
            ScopeLifecycle::Lapsed
        );
    }
}
