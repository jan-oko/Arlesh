//! Scope-containment rules shared by the Task and Goal operations.
//!
//! Containment is evaluated as interval containment on resolved datetime boundaries. Tasks and
//! Goals form a contiguous scoped chain (Domains/Projects/Aspects carry no scope and only parent
//! other Domains), so "nearest scoped ancestor" walks only the task/goal links directly above an
//! item. A null Time Scope inherits that ancestor's window.
//!
//! Every rule here reads tasks, goals *and* scopes, which is why each is a free function over a
//! [`Db`] session rather than a method on one resource's operator — see [`Db`]'s
//! `# Where an operation lives`. All of them are read-only analysis, so they are generic over the
//! session mode and serve `connect()` and `begin()` alike.
//!
//! None of them walks the tree itself. [`ancestry::climb`] reads the chain once and each rule is
//! a pure search over it, which is also where the broken-chain policy is chosen: the renderer
//! takes [`Search::or_unconstrained`](super::ancestry::Search::or_unconstrained) and keeps going,
//! a write takes [`Search::or_reject`](super::ancestry::Search::or_reject) and refuses.

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::database::session::{Db, SessionMode};
use crate::scopes::model::ScopeId;
use crate::scopes::resolve::{self, Bounds};

use super::ancestry;
use super::error::TaskError;
use super::lifecycle::{derive_item_state, Archival, ItemLifecycle};
use super::model::{GoalId, GoalStatus, OnScopeExit, TaskId, TaskStatus, TimeScope};

/// Maps a Goal's stored status to its baseline Archival value, for [`derive_item_state`]'s `stored`
/// parameter. `Achieved` intentionally maps to `Live`, not `Archived` — achievement is a separate,
/// additive concept (the Resolution axis' `Completed`), not the Archival axis. An unrecognized
/// status defensively falls back to `Live` (the least surprising default — never silently archives
/// or freezes something).
fn goal_stored_archival(status: &str) -> Archival {
    match GoalStatus::from_db(status) {
        Some(GoalStatus::Frozen) => Archival::Frozen,
        Some(GoalStatus::Archived) => Archival::Archived,
        Some(GoalStatus::Active) | Some(GoalStatus::Achieved) | None => Archival::Live,
    }
}

/// A descendant whose explicit Time Scope would fall outside a candidate window — i.e. one that
/// narrowing an ancestor's scope (or reparenting) would orphan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ViolatingDescendant {
    /// `"task"` or `"goal"`.
    pub node_type: String,
    /// The descendant's id.
    pub node_id: i64,
}

/// The effective `(window, on-exit behavior)` governing an item: its own when explicitly scoped,
/// else the nearest scoped ancestor's, or `None` when nothing above it is scoped (Unscoped). Unlike
/// [`nearest_scoped_ancestor_window`], the chain includes the node itself — this one climbs from
/// the node, the ancestor searches climb from its parent.
///
/// On the **read** path: a broken chain leaves the item unconstrained rather than failing, so one
/// corrupt row cannot blank the whole mindmap. The break is logged rather than swallowed.
pub(super) async fn scope_governance<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
) -> Result<Option<(Bounds, OnScopeExit)>, TaskError> {
    let chain = ancestry::climb(db, node_type, node_id).await?;
    let Some((time_scope, on_exit)) = chain.nearest_scoped().or_unconstrained() else {
        return Ok(None);
    };
    Ok(Some((time_scope_window(db, time_scope).await?, on_exit)))
}

/// Derives the full lifecycle state (Timing / Resolution / Archival — see `lifecycle`'s module
/// docs) of every Task and Goal at `now`, using each item's effective governance. A Task is
/// resolved once Done; a Goal once Achieved or Archived. Both carry a stored Archival: a Task its
/// Backlog column, a Goal its status via [`goal_stored_archival`].
///
/// Reads only — nothing is persisted, so a pooled session is enough.
pub async fn derive_all_scope_lifecycles<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
) -> Result<Vec<ItemLifecycle>, TaskError> {
    let mut out = Vec::new();
    for task in db.tasks().list().await? {
        let (window, on_exit) = match scope_governance(db, "task", task.id).await? {
            Some((w, e)) => (Some(w), Some(e)),
            None => (None, None),
        };
        let resolved = TaskStatus::from_db(&task.status) == Some(TaskStatus::Done);
        let stored = Some(Archival::from(task.archival));
        let state = derive_item_state(window, on_exit, resolved, stored, now);
        out.push(ItemLifecycle {
            node_type: "task".to_string(),
            node_id: task.id,
            timing: state.timing,
            resolution: state.resolution,
            archival: state.archival,
            archival_conflict: state.archival_conflict,
        });
    }
    for goal in db.goals().list().await? {
        let (window, on_exit) = match scope_governance(db, "goal", goal.id).await? {
            Some((w, e)) => (Some(w), Some(e)),
            None => (None, None),
        };
        let parsed_status = GoalStatus::from_db(&goal.status);
        let resolved = matches!(parsed_status, Some(GoalStatus::Achieved) | Some(GoalStatus::Archived));
        let stored = Some(goal_stored_archival(&goal.status));
        let state = derive_item_state(window, on_exit, resolved, stored, now);
        out.push(ItemLifecycle {
            node_type: "goal".to_string(),
            node_id: goal.id,
            timing: state.timing,
            resolution: state.resolution,
            archival: state.archival,
            archival_conflict: state.archival_conflict,
        });
    }
    Ok(out)
}

/// Resolves a single scope id to its half-open datetime window.
pub(super) async fn scope_window<M: SessionMode>(
    db: &mut Db<M>,
    scope_id: i64,
) -> Result<Bounds, TaskError> {
    let scope = db.scopes().get(ScopeId(scope_id)).await?;
    Ok(resolve::scope_bounds(&scope)?)
}

/// Resolves a Time Scope's boundaries to its combined window: the start of the start boundary
/// through the end of the end boundary.
pub async fn time_scope_window<M: SessionMode>(
    db: &mut Db<M>,
    time_scope: &TimeScope,
) -> Result<Bounds, TaskError> {
    let start = scope_window(db, time_scope.start_id).await?.0;
    let end = scope_window(db, time_scope.end_id).await?.1;
    Ok((start, end))
}

fn reject_unless_contained(outer: Bounds, inner: Bounds, message: &str) -> Result<(), TaskError> {
    if resolve::interval_contains(outer, inner) {
        Ok(())
    } else {
        Err(TaskError::ScopeContainment(message.to_string()))
    }
}

/// The four already-resolved windows the containment rules are checked over.
///
/// Every field is optional because every rule is conditional: a rule whose two inputs are not
/// both present has nothing to say and is skipped, which is how a task with no Plan and a goal
/// with no Plan column both fall out of the same check.
#[derive(Debug, Clone, Copy, Default)]
struct ContainmentWindows {
    /// The item's own Time Scope window.
    own_scope: Option<Bounds>,
    /// The item's Plan window.
    plan: Option<Bounds>,
    /// The nearest scoped ancestor's window.
    ancestor_scope: Option<Bounds>,
    /// The nearest planned task ancestor's Plan window.
    ancestor_plan: Option<Bounds>,
}

/// Checks the three containment rules and reports the **first** violation.
///
/// Pure: every window is resolved before it arrives, each exactly once, where the old code
/// climbed twice and re-resolved the same Time Scope up to twice more.
///
/// Reporting only the first violation is deliberate and not an oversight — the frontend acts on
/// one message, and collecting all three is an explicit non-goal. The rule order is the order
/// the old function checked in, so the message a given bad write produces has not changed.
fn check_containment(windows: ContainmentWindows) -> Result<(), TaskError> {
    if let (Some(own), Some(plan)) = (windows.own_scope, windows.plan) {
        reject_unless_contained(own, plan, "plan is not within the task's time scope")?;
    }
    if let (Some(ancestor), Some(own)) = (windows.ancestor_scope, windows.own_scope) {
        reject_unless_contained(ancestor, own, "time scope is not within the parent's time scope")?;
    }
    if let (Some(ancestor), Some(plan)) = (windows.ancestor_plan, windows.plan) {
        reject_unless_contained(ancestor, plan, "plan is not within the parent task's plan")?;
    }
    Ok(())
}

/// Resolves a Time Scope to its window when there is one — once, at the single point the check
/// needs it.
async fn resolve_optional<M: SessionMode>(
    db: &mut Db<M>,
    time_scope: Option<&TimeScope>,
) -> Result<Option<Bounds>, TaskError> {
    match time_scope {
        Some(ts) => Ok(Some(time_scope_window(db, ts).await?)),
        None => Ok(None),
    }
}

/// The window of the nearest ancestor of `(parent_type, parent_id)` — itself included — that has
/// an explicit Time Scope, or `None` if none is scoped.
///
/// On the **write** path: a broken chain rejects, because the constraint the caller is about to
/// check against could not be read.
pub async fn nearest_scoped_ancestor_window<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<Bounds>, TaskError> {
    let chain = ancestry::climb(db, parent_type, parent_id).await?;
    let Some((time_scope, _)) = chain.nearest_scoped().or_reject()? else {
        return Ok(None);
    };
    Ok(Some(time_scope_window(db, time_scope).await?))
}

/// Like [`nearest_scoped_ancestor_window`] but returns the ancestor's Time Scope itself (the clamp
/// target for a reparent), rather than its resolved datetime window.
pub(super) async fn nearest_scoped_ancestor_time_scope<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<TimeScope>, TaskError> {
    let chain = ancestry::climb(db, parent_type, parent_id).await?;
    Ok(chain.nearest_scoped().or_reject()?.map(|(time_scope, _)| time_scope.clone()))
}

/// Rejects a task write that breaks a containment invariant: Plan ⊆ own Time Scope, own Time
/// Scope ⊆ nearest scoped ancestor, and Plan ⊆ nearest planned ancestor. `parent_type`/`parent_id`
/// is the task's effective parent (the new one when reparenting).
///
/// **Climbs once.** The old shape walked the chain twice — once for the scoped ancestor and once
/// for the planned one — and resolved the item's own Time Scope up to twice more on top. Here
/// the chain is read once, both searches scan it, and each window is resolved exactly once
/// before [`check_containment`] decides.
///
/// A search is consulted only for the rule that needs it, which is what keeps a broken chain
/// rejecting exactly the writes it rejected before: a write with nothing to check asks nothing
/// of the ancestry and so cannot be refused by it.
pub(super) async fn validate_task_containment<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
    plan: &Option<TimeScope>,
) -> Result<(), TaskError> {
    if time_scope.is_none() && plan.is_none() {
        return Ok(());
    }
    let chain = ancestry::climb(db, parent_type, parent_id).await?;
    let ancestor_scope = match time_scope {
        Some(_) => chain.nearest_scoped().or_reject()?.map(|(scope, _)| scope),
        None => None,
    };
    let ancestor_plan = match plan {
        Some(_) => chain.nearest_planned().or_reject()?,
        None => None,
    };

    let own_scope = resolve_optional(db, time_scope.as_ref()).await?;
    let plan_window = resolve_optional(db, plan.as_ref()).await?;
    let ancestor_scope = resolve_optional(db, ancestor_scope).await?;
    let ancestor_plan = resolve_optional(db, ancestor_plan).await?;

    check_containment(ContainmentWindows {
        own_scope,
        plan: plan_window,
        ancestor_scope,
        ancestor_plan,
    })
}

/// Rejects a goal write whose Time Scope is not contained in its nearest scoped ancestor.
///
/// A strict subset of [`validate_task_containment`], and structurally so rather than by
/// repetition: a goal has no Plan, so two of [`ContainmentWindows`]' four fields are absent and
/// the same check reduces to rule two on its own.
pub(super) async fn validate_goal_containment<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
) -> Result<(), TaskError> {
    let Some(own) = time_scope else {
        return Ok(());
    };
    let chain = ancestry::climb(db, parent_type, parent_id).await?;
    let ancestor_scope = chain.nearest_scoped().or_reject()?.map(|(scope, _)| scope);

    let own_scope = Some(time_scope_window(db, own).await?);
    let ancestor_scope = resolve_optional(db, ancestor_scope).await?;

    check_containment(ContainmentWindows { own_scope, ancestor_scope, ..Default::default() })
}

/// Returns the direct task and goal children of a node, as `(node_type, node_id)` pairs.
async fn child_items<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
) -> Result<Vec<(String, i64)>, TaskError> {
    let mut children = Vec::new();
    let task_ids = db.tasks().child_ids(node_type, node_id).await?;
    children.extend(task_ids.into_iter().map(|id| ("task".to_string(), id)));
    let goal_ids = db.goals().child_ids(node_type, node_id).await?;
    children.extend(goal_ids.into_iter().map(|id| ("goal".to_string(), id)));
    Ok(children)
}

async fn item_time_scope<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
) -> Result<Option<TimeScope>, TaskError> {
    match node_type {
        "task" => Ok(db.tasks().get(TaskId(node_id)).await?.time_scope),
        "goal" => Ok(db.goals().get(GoalId(node_id)).await?.time_scope),
        _ => Ok(None),
    }
}

/// Finds task/goal descendants of `(node_type, node_id)` whose explicit Time Scope is not wholly
/// contained within `window` — the items a narrowing of this node's scope (or a reparent under a
/// tighter window) would orphan. Drives the frontend's clamp-or-cancel prompt.
pub(super) async fn descendants_violating_window<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
    window: Bounds,
) -> Result<Vec<ViolatingDescendant>, TaskError> {
    let mut violators = Vec::new();
    let mut stack = child_items(db, node_type, node_id).await?;
    while let Some((child_type, child_id)) = stack.pop() {
        if let Some(ts) = item_time_scope(db, &child_type, child_id).await? {
            let child_window = time_scope_window(db, &ts).await?;
            if !resolve::interval_contains(window, child_window) {
                violators.push(ViolatingDescendant {
                    node_type: child_type.clone(),
                    node_id: child_id,
                });
            }
        }
        stack.extend(child_items(db, &child_type, child_id).await?);
    }
    Ok(violators)
}

/// The outcome of checking a reparent: the binding ancestor Time Scope (the clamp target) and the
/// items — the node itself and/or its descendants — that would fall outside it.
#[derive(Debug, Clone, Serialize)]
pub struct ReparentConflicts {
    /// The nearest scoped ancestor's Time Scope under the new parent, or null if unconstrained.
    pub ancestor_time_scope: Option<TimeScope>,
    /// The items that would be orphaned (empty if the move is already valid).
    pub conflicts: Vec<ViolatingDescendant>,
}

/// Detects the items a reparent of `(node_type, node_id)` under `(new_parent_type, new_parent_id)`
/// would orphan: the node itself if its Time Scope no longer fits the new nearest-scoped-ancestor
/// window, plus any descendants that don't fit. `ancestor_time_scope` is the clamp target.
///
/// Reads only — nothing is persisted, so a pooled session is enough.
pub async fn reparent_conflicts<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
    new_parent_type: &str,
    new_parent_id: i64,
) -> Result<ReparentConflicts, TaskError> {
    let Some(ancestor) =
        nearest_scoped_ancestor_time_scope(db, new_parent_type, new_parent_id).await?
    else {
        return Ok(ReparentConflicts { ancestor_time_scope: None, conflicts: Vec::new() });
    };
    let window = time_scope_window(db, &ancestor).await?;
    let mut conflicts = Vec::new();
    if let Some(node_ts) = item_time_scope(db, node_type, node_id).await? {
        if !resolve::interval_contains(window, time_scope_window(db, &node_ts).await?) {
            conflicts.push(ViolatingDescendant { node_type: node_type.to_string(), node_id });
        }
    }
    conflicts.extend(descendants_violating_window(db, node_type, node_id, window).await?);
    Ok(ReparentConflicts { ancestor_time_scope: Some(ancestor), conflicts })
}

/// Resolves a candidate Time Scope for a node and returns the descendants it would orphan.
///
/// Reads only — nothing is persisted, so a pooled session is enough.
pub async fn conflicts_for_new_time_scope<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
    time_scope: &TimeScope,
) -> Result<Vec<ViolatingDescendant>, TaskError> {
    let window = time_scope_window(db, time_scope).await?;
    descendants_violating_window(db, node_type, node_id, window).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    /// A window spanning `[from, to)` in July 2026, by day-of-month. Pure test data: nothing
    /// here resolves a scope, because [`check_containment`] never does.
    fn july(from: u32, to: u32) -> Bounds {
        let at = |day| {
            NaiveDate::from_ymd_opt(2026, 7, day)
                .expect("July has this day")
                .and_hms_opt(0, 0, 0)
                .expect("midnight is a time")
        };
        (at(from), at(to))
    }

    /// The `ScopeContainment` message, or a panic naming what came back instead.
    fn violation(result: Result<(), TaskError>) -> String {
        match result {
            Err(TaskError::ScopeContainment(message)) => message,
            other => panic!("expected a containment violation, got {other:?}"),
        }
    }

    #[test]
    fn a_task_nested_inside_every_window_above_it_is_accepted() {
        let windows = ContainmentWindows {
            own_scope: Some(july(10, 20)),
            plan: Some(july(12, 14)),
            ancestor_scope: Some(july(1, 31)),
            ancestor_plan: Some(july(11, 15)),
        };

        assert!(check_containment(windows).is_ok());
    }

    #[test]
    fn a_plan_escaping_its_own_time_scope_is_rejected() {
        let windows = ContainmentWindows {
            own_scope: Some(july(10, 20)),
            plan: Some(july(18, 25)),
            ..Default::default()
        };

        assert_eq!(
            violation(check_containment(windows)),
            "plan is not within the task's time scope"
        );
    }

    #[test]
    fn a_time_scope_escaping_the_nearest_scoped_ancestor_is_rejected() {
        let windows = ContainmentWindows {
            own_scope: Some(july(10, 20)),
            ancestor_scope: Some(july(12, 18)),
            ..Default::default()
        };

        assert_eq!(
            violation(check_containment(windows)),
            "time scope is not within the parent's time scope"
        );
    }

    #[test]
    fn a_plan_escaping_the_nearest_planned_ancestor_is_rejected() {
        let windows = ContainmentWindows {
            plan: Some(july(10, 20)),
            ancestor_plan: Some(july(12, 18)),
            ..Default::default()
        };

        assert_eq!(
            violation(check_containment(windows)),
            "plan is not within the parent task's plan"
        );
    }

    #[test]
    fn the_first_violation_is_the_only_one_reported() {
        // Every rule is broken at once. Collecting all three is a deliberate non-goal, so the
        // message must be rule one's and the check must stop there.
        let windows = ContainmentWindows {
            own_scope: Some(july(10, 20)),
            plan: Some(july(1, 31)),
            ancestor_scope: Some(july(12, 18)),
            ancestor_plan: Some(july(13, 14)),
        };

        assert_eq!(
            violation(check_containment(windows)),
            "plan is not within the task's time scope"
        );
    }

    #[test]
    fn a_rule_whose_windows_are_not_both_present_is_skipped() {
        // Unconstrained above and unplanned: only rule one has both its inputs, and it holds.
        let unconstrained = ContainmentWindows {
            own_scope: Some(july(10, 20)),
            plan: Some(july(12, 14)),
            ..Default::default()
        };
        assert!(check_containment(unconstrained).is_ok());

        // A plan escaping every window above it, on an item that has no plan of its own: two
        // rules go quiet rather than firing on a window that is not there.
        let unplanned = ContainmentWindows {
            own_scope: Some(july(10, 20)),
            ancestor_scope: Some(july(1, 31)),
            ancestor_plan: Some(july(13, 14)),
            ..Default::default()
        };
        assert!(check_containment(unplanned).is_ok());
    }

    #[test]
    fn a_goal_shaped_check_reduces_to_the_ancestor_rule_alone() {
        // A goal has no Plan, so `plan` and `ancestor_plan` are structurally absent and rules
        // one and three cannot fire. That is the whole of `validate_goal_containment`.
        let inside = ContainmentWindows {
            own_scope: Some(july(10, 20)),
            ancestor_scope: Some(july(1, 31)),
            ..Default::default()
        };
        assert!(check_containment(inside).is_ok());

        let outside = ContainmentWindows {
            own_scope: Some(july(10, 20)),
            ancestor_scope: Some(july(12, 18)),
            ..Default::default()
        };
        assert_eq!(
            violation(check_containment(outside)),
            "time scope is not within the parent's time scope"
        );
    }
}
