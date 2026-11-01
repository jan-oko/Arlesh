//! Tauri commands for task and goal operations.

use tauri::State;

use crate::backend::AppBackend;
use crate::{
    duplicate::DuplicatedSubtree,
    error::WireError,
    nodes::id::NodeId,
    tasks::{
        lifecycle::ItemLifecycle,
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, DescendantPlans, Goal, Task,
            TaskDependencyEdge, TaskWithBlockers, TimeScope, UpdateGoalRequest, UpdateTaskRequest,
        },
        ReparentConflicts, ViolatingDescendant,
    },
};

/// Creates a new task.
#[tauri::command]
pub async fn create_task(
    backend: State<'_, AppBackend>,
    request: CreateTaskRequest,
) -> Result<Task, WireError> {
    backend.create_task(request).await
}

/// Fetches a task by id with computed blockers.
#[tauri::command]
pub async fn get_task(
    backend: State<'_, AppBackend>,
    id: i64,
) -> Result<TaskWithBlockers, WireError> {
    backend.get_task(id).await
}

/// Lists every task — the Task virtual table: stored rows and every Habit occurrence.
#[tauri::command]
pub async fn list_tasks(
    backend: State<'_, AppBackend>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<Task>, WireError> {
    backend.list_tasks(now).await
}

/// Updates a task, stored or derived: a Habit occurrence's update lands in its overlay.
///
/// Marking a Habit occurrence **done** while it still holds unfinished added children is refused
/// with [`NeedsConfirmation`](crate::error::WireErrorKind::NeedsConfirmation) until `confirmed`
/// says the caller has seen them; the refusal names every one. Confirming completes it and leaves
/// the children exactly as they are, to archive with it when its window passes.
#[tauri::command]
pub async fn update_task(
    backend: State<'_, AppBackend>,
    id: NodeId,
    request: UpdateTaskRequest,
    confirmed: Option<bool>,
) -> Result<Task, WireError> {
    backend.update_task(id, request, confirmed).await
}

/// [`update_task`], settling the Tasks below whose own Plan the new Plan would leave outside as
/// `descendant_plans` says — clamped into it, or cleared to inherit it — in the same write: the
/// answer to the clamp-or-cancel prompt ([`plan_containment_conflicts`]).
#[tauri::command]
pub async fn update_task_settling_plans(
    backend: State<'_, AppBackend>,
    id: NodeId,
    request: UpdateTaskRequest,
    confirmed: Option<bool>,
    descendant_plans: DescendantPlans,
) -> Result<Task, WireError> {
    backend
        .update_task_settling_plans(id, request, confirmed, descendant_plans)
        .await
}

/// What the Task `id` may be made to depend on — what the quick dependency picker offers: every
/// Task that can hold a prerequisite, every Goal and every stored Expectation on the board, less
/// what it already depends on and every Task whose edge would close a cycle
/// ([`crate::tasks::rules::dependencies::candidates`]).
#[tauri::command]
pub async fn dependency_candidates(
    backend: State<'_, AppBackend>,
    id: NodeId,
) -> Result<Vec<Dependency>, WireError> {
    backend.dependency_candidates(id).await
}

/// The Tasks below the Task `id` whose own Plan `plan` would leave outside the Plan they inherit,
/// each with what clamping would give it — for the clamp-or-cancel prompt before a Plan is
/// narrowed or moved. Nearest first.
#[tauri::command]
pub async fn plan_containment_conflicts(
    backend: State<'_, AppBackend>,
    id: NodeId,
    plan: Option<TimeScope>,
) -> Result<Vec<crate::mindmap::rules::plans::PlanClampTarget>, WireError> {
    backend.plan_containment_conflicts(id, plan).await
}

/// Returns the task/goal descendants of a node that a candidate Time Scope would orphan, for the
/// frontend's clamp-or-cancel prompt before narrowing a scope or reparenting.
#[tauri::command]
pub async fn scope_containment_conflicts(
    backend: State<'_, AppBackend>,
    node_type: String,
    node_id: i64,
    time_scope: TimeScope,
) -> Result<Vec<ViolatingDescendant>, WireError> {
    backend
        .scope_containment_conflicts(node_type, node_id, time_scope)
        .await
}

/// Returns the items a reparent of `node` under `new_parent` would orphan, plus the ancestor Time
/// Scope to clamp them to — for a clamp-or-cancel prompt before the move.
#[tauri::command]
pub async fn reparent_scope_conflicts(
    backend: State<'_, AppBackend>,
    node_type: String,
    node_id: i64,
    new_parent_type: String,
    new_parent_id: i64,
) -> Result<ReparentConflicts, WireError> {
    backend
        .reparent_scope_conflicts(node_type, node_id, new_parent_type, new_parent_id)
        .await
}

/// Deletes a task — or archives a Habit occurrence, which is never deleted.
#[tauri::command]
pub async fn delete_task(backend: State<'_, AppBackend>, id: NodeId) -> Result<(), WireError> {
    backend.delete_task(id).await
}

/// Deep-clones a task and its whole subtree under `(target_type, target_id)`, putting the new
/// root at `position`. Backs the Mindmap's Copy+Paste.
///
/// Transactional: the subtree lands whole or not at all, Flows included. Returns the copy with
/// the rows hung on Habit occurrences that it could not carry, for the paste to name.
#[tauri::command]
pub async fn duplicate_task(
    backend: State<'_, AppBackend>,
    id: i64,
    target_type: String,
    target_id: i64,
    position: i64,
) -> Result<DuplicatedSubtree<Task>, WireError> {
    backend
        .duplicate_task(id, target_type, target_id, position)
        .await
}

/// Adds a dependency to a task.
///
/// Transactional despite writing only once: the cycle check in front of the `INSERT` is a read the
/// write depends on, and without a transaction two concurrent calls can each see no cycle and
/// jointly create one. The transaction closes that window — SQLite refuses the second writer
/// rather than letting both land.
#[tauri::command]
pub async fn add_task_dependency(
    backend: State<'_, AppBackend>,
    task_id: NodeId,
    dependency: Dependency,
) -> Result<(), WireError> {
    backend.add_task_dependency(task_id, dependency).await
}

/// Removes a dependency from a task.
#[tauri::command]
pub async fn remove_task_dependency(
    backend: State<'_, AppBackend>,
    task_id: NodeId,
    dependency: Dependency,
) -> Result<(), WireError> {
    backend.remove_task_dependency(task_id, dependency).await
}

/// Lists what one task depends on — a stored one, or a Habit occurrence, whose edges are its
/// template's with its own differences applied.
#[tauri::command]
pub async fn list_task_dependencies(
    backend: State<'_, AppBackend>,
    task_id: NodeId,
) -> Result<Vec<Dependency>, WireError> {
    backend.list_task_dependencies(task_id).await
}

/// When a Done task was done — a stored one, or a Habit occurrence — as a local wall-clock
/// instant, or `None` while it is not Done.
#[tauri::command]
pub async fn task_done_at(
    backend: State<'_, AppBackend>,
    id: NodeId,
) -> Result<Option<chrono::NaiveDateTime>, WireError> {
    backend.task_done_at(id).await
}

/// Sets a Done task's done date — when it was really done, for work marked done late. Refused for
/// a task that is not Done and for an instant in the future.
#[tauri::command]
pub async fn set_task_done_at(
    backend: State<'_, AppBackend>,
    id: NodeId,
    at: chrono::NaiveDateTime,
) -> Result<(), WireError> {
    backend.set_task_done_at(id, at).await
}

/// Lists every task-dependency edge on the board, stored and derived.
#[tauri::command]
pub async fn list_all_task_dependencies(
    backend: State<'_, AppBackend>,
) -> Result<Vec<TaskDependencyEdge>, WireError> {
    backend.list_all_task_dependencies().await
}

/// Creates a new goal.
#[tauri::command]
pub async fn create_goal(
    backend: State<'_, AppBackend>,
    request: CreateGoalRequest,
) -> Result<Goal, WireError> {
    backend.create_goal(request).await
}

/// Fetches a goal by id.
#[tauri::command]
pub async fn get_goal(backend: State<'_, AppBackend>, id: i64) -> Result<Goal, WireError> {
    backend.get_goal(id).await
}

/// Lists every goal — the Goal virtual table: stored rows and every Habit occurrence.
#[tauri::command]
pub async fn list_goals(
    backend: State<'_, AppBackend>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<Goal>, WireError> {
    backend.list_goals(now).await
}

/// Updates a goal, stored or derived. Achieving a Habit occurrence that still holds unfinished
/// added children is refused pending confirmation, exactly as completing a Task one is.
#[tauri::command]
pub async fn update_goal(
    backend: State<'_, AppBackend>,
    id: NodeId,
    request: UpdateGoalRequest,
    confirmed: Option<bool>,
) -> Result<Goal, WireError> {
    backend.update_goal(id, request, confirmed).await
}

/// Deletes a goal — or archives a Habit occurrence, which is never deleted.
#[tauri::command]
pub async fn delete_goal(backend: State<'_, AppBackend>, id: NodeId) -> Result<(), WireError> {
    backend.delete_goal(id).await
}

/// Deep-clones a goal and its whole subtree under `(target_type, target_id)`, putting the new
/// root at `position`. Backs the Mindmap's Copy+Paste.
///
/// Transactional: the subtree lands whole or not at all, Flows included. Returns the copy with
/// the rows hung on Habit occurrences that it could not carry, for the paste to name.
#[tauri::command]
pub async fn duplicate_goal(
    backend: State<'_, AppBackend>,
    id: i64,
    target_type: String,
    target_id: i64,
    position: i64,
) -> Result<DuplicatedSubtree<Goal>, WireError> {
    backend
        .duplicate_goal(id, target_type, target_id, position)
        .await
}

/// Adds a tag to a task.
#[tauri::command]
pub async fn add_tag_to_task(
    backend: State<'_, AppBackend>,
    task_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    backend.add_tag_to_task(task_id, tag_id).await
}

/// Removes a tag from a task.
#[tauri::command]
pub async fn remove_tag_from_task(
    backend: State<'_, AppBackend>,
    task_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    backend.remove_tag_from_task(task_id, tag_id).await
}

/// Adds a tag to a goal.
#[tauri::command]
pub async fn add_tag_to_goal(
    backend: State<'_, AppBackend>,
    goal_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    backend.add_tag_to_goal(goal_id, tag_id).await
}

/// Removes a tag from a goal.
#[tauri::command]
pub async fn remove_tag_from_goal(
    backend: State<'_, AppBackend>,
    goal_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    backend.remove_tag_from_goal(goal_id, tag_id).await
}

/// Derives the scope lifecycle (Active / Overdue / Lapsed) of every Task and Goal at `now`
/// (local wall-clock). Nothing is persisted — the result is a pure function of scope, status,
/// and the reference instant.
#[tauri::command]
pub async fn derive_scope_lifecycles(
    backend: State<'_, AppBackend>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<ItemLifecycle>, WireError> {
    backend.derive_scope_lifecycles(now).await
}
