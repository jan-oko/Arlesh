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

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::database::session::{Db, SessionFactory, SessionMode};
use crate::database::DatabasePool;
use crate::scopes::model::ScopeId;
use crate::scopes::resolve::{self, Bounds};

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

/// The effective Time Scope window governing children placed under `(node_type, node_id)`: the
/// node's own window when scoped, otherwise the nearest scoped ancestor's, or `None` when nothing
/// above it is scoped (unconstrained). Non-task/goal kinds carry no scope and return `None`.
///
/// **Transitional.** It takes a pool because `flows` — Task 2.2 Step 4 — still holds one and has
/// no session to lend, so it opens a pooled session of its own and delegates. Once `flows` runs on
/// sessions its call becomes a direct `nearest_scoped_ancestor_window` and this goes away.
pub async fn effective_window(
    pool: &DatabasePool,
    node_type: &str,
    node_id: i64,
) -> Result<Option<Bounds>, TaskError> {
    let mut db = SessionFactory::new(pool.clone()).connect().await?;
    nearest_scoped_ancestor_window(&mut db, node_type, node_id).await
}

/// Resolves a Time Scope to its combined half-open datetime window.
///
/// **Transitional**, for the same reason as [`effective_window`]: it exists so that pool-bound
/// `flows` can still reach the session-based `time_scope_window`.
pub async fn time_scope_bounds(
    pool: &DatabasePool,
    time_scope: &TimeScope,
) -> Result<Bounds, TaskError> {
    let mut db = SessionFactory::new(pool.clone()).connect().await?;
    time_scope_window(&mut db, time_scope).await
}

/// The effective `(window, on-exit behavior)` governing an item: its own when explicitly scoped,
/// else the nearest scoped ancestor's, or `None` when nothing above it is scoped (Unscoped). Unlike
/// [`nearest_scoped_ancestor_window`], the walk includes the node itself.
pub(super) async fn scope_governance<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
) -> Result<Option<(Bounds, OnScopeExit)>, TaskError> {
    let mut node_type = node_type.to_string();
    let mut node_id = node_id;
    loop {
        match node_type.as_str() {
            "task" => {
                // A dangling parent (the referenced item was deleted) breaks the chain: there is no
                // scoped ancestor above it, so the item is unconstrained rather than an error.
                let task = match db.tasks().get(TaskId(node_id)).await {
                    Ok(task) => task,
                    Err(TaskError::TaskNotFound(_)) => return Ok(None),
                    Err(error) => return Err(error),
                };
                if let Some(ts) = &task.time_scope {
                    let window = time_scope_window(db, ts).await?;
                    return Ok(Some((window, task.on_scope_exit.unwrap_or(OnScopeExit::Keep))));
                }
                node_type = task.parent_type;
                node_id = task.parent_id;
            }
            "goal" => {
                let goal = match db.goals().get(GoalId(node_id)).await {
                    Ok(goal) => goal,
                    Err(TaskError::GoalNotFound(_)) => return Ok(None),
                    Err(error) => return Err(error),
                };
                if let Some(ts) = &goal.time_scope {
                    let window = time_scope_window(db, ts).await?;
                    return Ok(Some((window, goal.on_scope_exit.unwrap_or(OnScopeExit::Keep))));
                }
                node_type = goal.parent_type;
                node_id = goal.parent_id;
            }
            _ => return Ok(None),
        }
    }
}

/// Derives the full lifecycle state (Timing / Resolution / Archival — see `lifecycle`'s module
/// docs) of every Task and Goal at `now`, using each item's effective governance. A Task is
/// resolved once Done; a Goal once Achieved or Archived. Tasks have no manual Archival concept
/// (always fully derived); Goals carry their own stored Archival via [`goal_stored_archival`].
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
        let state = derive_item_state(window, on_exit, resolved, None, now);
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
pub(super) async fn time_scope_window<M: SessionMode>(
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

/// Walks up the contiguous task/goal ancestor chain from a parent reference, returning the window
/// of the nearest ancestor that has an explicit Time Scope, or `None` if none is scoped.
pub(super) async fn nearest_scoped_ancestor_window<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<Bounds>, TaskError> {
    let mut node_type = parent_type.to_string();
    let mut node_id = parent_id;
    loop {
        match node_type.as_str() {
            "task" => {
                let task = db.tasks().get(TaskId(node_id)).await?;
                if let Some(ts) = &task.time_scope {
                    return Ok(Some(time_scope_window(db, ts).await?));
                }
                node_type = task.parent_type;
                node_id = task.parent_id;
            }
            "goal" => {
                let goal = db.goals().get(GoalId(node_id)).await?;
                if let Some(ts) = &goal.time_scope {
                    return Ok(Some(time_scope_window(db, ts).await?));
                }
                node_type = goal.parent_type;
                node_id = goal.parent_id;
            }
            _ => return Ok(None),
        }
    }
}

/// Like [`nearest_scoped_ancestor_window`] but returns the ancestor's Time Scope itself (the clamp
/// target for a reparent), rather than its resolved datetime window.
pub(super) async fn nearest_scoped_ancestor_time_scope<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<TimeScope>, TaskError> {
    let mut node_type = parent_type.to_string();
    let mut node_id = parent_id;
    loop {
        match node_type.as_str() {
            "task" => {
                let task = db.tasks().get(TaskId(node_id)).await?;
                if let Some(ts) = task.time_scope {
                    return Ok(Some(ts));
                }
                node_type = task.parent_type;
                node_id = task.parent_id;
            }
            "goal" => {
                let goal = db.goals().get(GoalId(node_id)).await?;
                if let Some(ts) = goal.time_scope {
                    return Ok(Some(ts));
                }
                node_type = goal.parent_type;
                node_id = goal.parent_id;
            }
            _ => return Ok(None),
        }
    }
}

/// Walks up the contiguous task ancestor chain, returning the window of the nearest task ancestor
/// that has a Plan, or `None`.
pub(super) async fn nearest_planned_ancestor_window<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<Bounds>, TaskError> {
    let mut node_type = parent_type.to_string();
    let mut node_id = parent_id;
    loop {
        match node_type.as_str() {
            "task" => {
                let task = db.tasks().get(TaskId(node_id)).await?;
                if let Some(plan) = &task.plan {
                    return Ok(Some(time_scope_window(db, plan).await?));
                }
                node_type = task.parent_type;
                node_id = task.parent_id;
            }
            _ => return Ok(None),
        }
    }
}

/// Rejects a task write that breaks a containment invariant: Plan ⊆ own Time Scope, own Time
/// Scope ⊆ nearest scoped ancestor, and Plan ⊆ nearest planned ancestor. `parent_type`/`parent_id`
/// is the task's effective parent (the new one when reparenting).
pub(super) async fn validate_task_containment<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
    plan: &Option<TimeScope>,
) -> Result<(), TaskError> {
    if let (Some(ts), Some(plan_ts)) = (time_scope, plan) {
        let time_window = time_scope_window(db, ts).await?;
        let plan_window = time_scope_window(db, plan_ts).await?;
        reject_unless_contained(
            time_window,
            plan_window,
            "plan is not within the task's time scope",
        )?;
    }
    if let Some(ts) = time_scope {
        if let Some(ancestor) = nearest_scoped_ancestor_window(db, parent_type, parent_id).await? {
            let time_window = time_scope_window(db, ts).await?;
            reject_unless_contained(
                ancestor,
                time_window,
                "time scope is not within the parent's time scope",
            )?;
        }
    }
    if let Some(plan_ts) = plan {
        if let Some(ancestor) = nearest_planned_ancestor_window(db, parent_type, parent_id).await? {
            let plan_window = time_scope_window(db, plan_ts).await?;
            reject_unless_contained(
                ancestor,
                plan_window,
                "plan is not within the parent task's plan",
            )?;
        }
    }
    Ok(())
}

/// Rejects a goal write whose Time Scope is not contained in its nearest scoped ancestor.
pub(super) async fn validate_goal_containment<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
) -> Result<(), TaskError> {
    if let Some(ts) = time_scope {
        if let Some(ancestor) = nearest_scoped_ancestor_window(db, parent_type, parent_id).await? {
            let time_window = time_scope_window(db, ts).await?;
            reject_unless_contained(
                ancestor,
                time_window,
                "time scope is not within the parent's time scope",
            )?;
        }
    }
    Ok(())
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
