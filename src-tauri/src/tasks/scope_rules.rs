//! Scope-containment rules shared by the Task and Goal repositories.
//!
//! Containment is evaluated as interval containment on resolved datetime boundaries. Tasks and
//! Goals form a contiguous scoped chain (Domains/Projects/Aspects carry no scope and only parent
//! other Domains), so "nearest scoped ancestor" walks only the task/goal links directly above an
//! item. A null Time Scope inherits that ancestor's window.

use serde::Serialize;

use crate::database::DatabasePool;
use crate::scopes::model::ScopeId;
use crate::scopes::resolve::{self, Bounds};
use crate::scopes::ScopeRepository;

use super::error::TaskError;
use super::model::{GoalId, TaskId, TimeScope};
use super::{GoalRepository, TaskRepository};

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
pub async fn effective_window(
    pool: &DatabasePool,
    node_type: &str,
    node_id: i64,
) -> Result<Option<Bounds>, TaskError> {
    nearest_scoped_ancestor_window(pool, node_type, node_id).await
}

/// Resolves a Time Scope to its combined half-open datetime window.
pub async fn time_scope_bounds(
    pool: &DatabasePool,
    time_scope: &TimeScope,
) -> Result<Bounds, TaskError> {
    time_scope_window(pool, time_scope).await
}

/// Resolves a single scope id to its half-open datetime window.
pub(super) async fn scope_window(pool: &DatabasePool, scope_id: i64) -> Result<Bounds, TaskError> {
    let scope = ScopeRepository::new(pool).get(ScopeId(scope_id)).await?;
    Ok(resolve::scope_bounds(&scope)?)
}

/// Resolves a Time Scope's boundaries to its combined window: the start of the start boundary
/// through the end of the end boundary.
pub(super) async fn time_scope_window(
    pool: &DatabasePool,
    time_scope: &TimeScope,
) -> Result<Bounds, TaskError> {
    let start = scope_window(pool, time_scope.start_id).await?.0;
    let end = scope_window(pool, time_scope.end_id).await?.1;
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
pub(super) async fn nearest_scoped_ancestor_window(
    pool: &DatabasePool,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<Bounds>, TaskError> {
    let mut node_type = parent_type.to_string();
    let mut node_id = parent_id;
    loop {
        match node_type.as_str() {
            "task" => {
                let task = TaskRepository::new(pool).get(TaskId(node_id)).await?;
                if let Some(ts) = &task.time_scope {
                    return Ok(Some(time_scope_window(pool, ts).await?));
                }
                node_type = task.parent_type;
                node_id = task.parent_id;
            }
            "goal" => {
                let goal = GoalRepository::new(pool).get(GoalId(node_id)).await?;
                if let Some(ts) = &goal.time_scope {
                    return Ok(Some(time_scope_window(pool, ts).await?));
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
pub(super) async fn nearest_scoped_ancestor_time_scope(
    pool: &DatabasePool,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<TimeScope>, TaskError> {
    let mut node_type = parent_type.to_string();
    let mut node_id = parent_id;
    loop {
        match node_type.as_str() {
            "task" => {
                let task = TaskRepository::new(pool).get(TaskId(node_id)).await?;
                if let Some(ts) = task.time_scope {
                    return Ok(Some(ts));
                }
                node_type = task.parent_type;
                node_id = task.parent_id;
            }
            "goal" => {
                let goal = GoalRepository::new(pool).get(GoalId(node_id)).await?;
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
pub(super) async fn nearest_planned_ancestor_window(
    pool: &DatabasePool,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<Bounds>, TaskError> {
    let mut node_type = parent_type.to_string();
    let mut node_id = parent_id;
    loop {
        match node_type.as_str() {
            "task" => {
                let task = TaskRepository::new(pool).get(TaskId(node_id)).await?;
                if let Some(plan) = &task.plan {
                    return Ok(Some(time_scope_window(pool, plan).await?));
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
pub(super) async fn validate_task_containment(
    pool: &DatabasePool,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
    plan: &Option<TimeScope>,
) -> Result<(), TaskError> {
    if let (Some(ts), Some(plan_ts)) = (time_scope, plan) {
        let time_window = time_scope_window(pool, ts).await?;
        let plan_window = time_scope_window(pool, plan_ts).await?;
        reject_unless_contained(
            time_window,
            plan_window,
            "plan is not within the task's time scope",
        )?;
    }
    if let Some(ts) = time_scope {
        if let Some(ancestor) = nearest_scoped_ancestor_window(pool, parent_type, parent_id).await? {
            let time_window = time_scope_window(pool, ts).await?;
            reject_unless_contained(
                ancestor,
                time_window,
                "time scope is not within the parent's time scope",
            )?;
        }
    }
    if let Some(plan_ts) = plan {
        if let Some(ancestor) = nearest_planned_ancestor_window(pool, parent_type, parent_id).await?
        {
            let plan_window = time_scope_window(pool, plan_ts).await?;
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
pub(super) async fn validate_goal_containment(
    pool: &DatabasePool,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
) -> Result<(), TaskError> {
    if let Some(ts) = time_scope {
        if let Some(ancestor) = nearest_scoped_ancestor_window(pool, parent_type, parent_id).await? {
            let time_window = time_scope_window(pool, ts).await?;
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
async fn child_items(
    pool: &DatabasePool,
    node_type: &str,
    node_id: i64,
) -> Result<Vec<(String, i64)>, TaskError> {
    let mut children = Vec::new();
    let task_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM tasks WHERE parent_type = ? AND parent_id = ?")
            .bind(node_type)
            .bind(node_id)
            .fetch_all(pool)
            .await?;
    children.extend(task_ids.into_iter().map(|id| ("task".to_string(), id)));
    let goal_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM goals WHERE parent_type = ? AND parent_id = ?")
            .bind(node_type)
            .bind(node_id)
            .fetch_all(pool)
            .await?;
    children.extend(goal_ids.into_iter().map(|id| ("goal".to_string(), id)));
    Ok(children)
}

async fn item_time_scope(
    pool: &DatabasePool,
    node_type: &str,
    node_id: i64,
) -> Result<Option<TimeScope>, TaskError> {
    match node_type {
        "task" => Ok(TaskRepository::new(pool).get(TaskId(node_id)).await?.time_scope),
        "goal" => Ok(GoalRepository::new(pool).get(GoalId(node_id)).await?.time_scope),
        _ => Ok(None),
    }
}

/// Finds task/goal descendants of `(node_type, node_id)` whose explicit Time Scope is not wholly
/// contained within `window` — the items a narrowing of this node's scope (or a reparent under a
/// tighter window) would orphan. Drives the frontend's clamp-or-cancel prompt.
pub(super) async fn descendants_violating_window(
    pool: &DatabasePool,
    node_type: &str,
    node_id: i64,
    window: Bounds,
) -> Result<Vec<ViolatingDescendant>, TaskError> {
    let mut violators = Vec::new();
    let mut stack = child_items(pool, node_type, node_id).await?;
    while let Some((child_type, child_id)) = stack.pop() {
        if let Some(ts) = item_time_scope(pool, &child_type, child_id).await? {
            let child_window = time_scope_window(pool, &ts).await?;
            if !resolve::interval_contains(window, child_window) {
                violators.push(ViolatingDescendant {
                    node_type: child_type.clone(),
                    node_id: child_id,
                });
            }
        }
        stack.extend(child_items(pool, &child_type, child_id).await?);
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
pub(super) async fn reparent_conflicts(
    pool: &DatabasePool,
    node_type: &str,
    node_id: i64,
    new_parent_type: &str,
    new_parent_id: i64,
) -> Result<ReparentConflicts, TaskError> {
    let Some(ancestor) =
        nearest_scoped_ancestor_time_scope(pool, new_parent_type, new_parent_id).await?
    else {
        return Ok(ReparentConflicts { ancestor_time_scope: None, conflicts: Vec::new() });
    };
    let window = time_scope_window(pool, &ancestor).await?;
    let mut conflicts = Vec::new();
    if let Some(node_ts) = item_time_scope(pool, node_type, node_id).await? {
        if !resolve::interval_contains(window, time_scope_window(pool, &node_ts).await?) {
            conflicts.push(ViolatingDescendant { node_type: node_type.to_string(), node_id });
        }
    }
    conflicts.extend(descendants_violating_window(pool, node_type, node_id, window).await?);
    Ok(ReparentConflicts { ancestor_time_scope: Some(ancestor), conflicts })
}

/// Resolves a candidate Time Scope for a node and returns the descendants it would orphan.
pub(super) async fn conflicts_for_new_time_scope(
    pool: &DatabasePool,
    node_type: &str,
    node_id: i64,
    time_scope: &TimeScope,
) -> Result<Vec<ViolatingDescendant>, TaskError> {
    let window = time_scope_window(pool, time_scope).await?;
    descendants_violating_window(pool, node_type, node_id, window).await
}
