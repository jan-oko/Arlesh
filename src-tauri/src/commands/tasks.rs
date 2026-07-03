//! Tauri commands for task and goal operations.

use tauri::State;

use crate::{
    database::DatabasePool,
    tasks::{
        derive_all_scope_lifecycles,
        lifecycle::ItemLifecycle,
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, Goal, GoalId, Task, TaskId,
            TaskWithBlockers, TimeScope, UpdateGoalRequest, UpdateTaskRequest,
        },
        GoalRepository, ReparentConflicts, TaskRepository, ViolatingDescendant,
    },
};

/// Creates a new task.
#[tauri::command]
pub async fn create_task(
    pool: State<'_, DatabasePool>,
    request: CreateTaskRequest,
) -> Result<Task, String> {
    TaskRepository::new(&pool)
        .create(request)
        .await
        .map_err(|error| error.to_string())
}

/// Fetches a task by id with computed blockers.
#[tauri::command]
pub async fn get_task(
    pool: State<'_, DatabasePool>,
    id: i64,
) -> Result<TaskWithBlockers, String> {
    TaskRepository::new(&pool)
        .get_with_blockers(TaskId(id))
        .await
        .map_err(|error| error.to_string())
}

/// Lists all tasks.
#[tauri::command]
pub async fn list_tasks(pool: State<'_, DatabasePool>) -> Result<Vec<Task>, String> {
    TaskRepository::new(&pool)
        .list()
        .await
        .map_err(|error| error.to_string())
}

/// Updates a task.
#[tauri::command]
pub async fn update_task(
    pool: State<'_, DatabasePool>,
    id: i64,
    request: UpdateTaskRequest,
) -> Result<Task, String> {
    TaskRepository::new(&pool)
        .update(TaskId(id), request)
        .await
        .map_err(|error| error.to_string())
}

/// Returns the task/goal descendants of a node that a candidate Time Scope would orphan, for the
/// frontend's clamp-or-cancel prompt before narrowing a scope or reparenting.
#[tauri::command]
pub async fn scope_containment_conflicts(
    pool: State<'_, DatabasePool>,
    node_type: String,
    node_id: i64,
    time_scope: TimeScope,
) -> Result<Vec<ViolatingDescendant>, String> {
    TaskRepository::new(&pool)
        .scope_containment_conflicts(&node_type, node_id, &time_scope)
        .await
        .map_err(|error| error.to_string())
}

/// Returns the items a reparent of `node` under `new_parent` would orphan, plus the ancestor Time
/// Scope to clamp them to — for a clamp-or-cancel prompt before the move.
#[tauri::command]
pub async fn reparent_scope_conflicts(
    pool: State<'_, DatabasePool>,
    node_type: String,
    node_id: i64,
    new_parent_type: String,
    new_parent_id: i64,
) -> Result<ReparentConflicts, String> {
    TaskRepository::new(&pool)
        .reparent_scope_conflicts(&node_type, node_id, &new_parent_type, new_parent_id)
        .await
        .map_err(|error| error.to_string())
}

/// Deletes a task.
#[tauri::command]
pub async fn delete_task(pool: State<'_, DatabasePool>, id: i64) -> Result<(), String> {
    TaskRepository::new(&pool)
        .delete(TaskId(id))
        .await
        .map_err(|error| error.to_string())
}

/// Adds a dependency to a task.
#[tauri::command]
pub async fn add_task_dependency(
    pool: State<'_, DatabasePool>,
    task_id: i64,
    dependency: Dependency,
) -> Result<(), String> {
    TaskRepository::new(&pool)
        .add_dependency(TaskId(task_id), dependency)
        .await
        .map_err(|error| error.to_string())
}

/// Removes a dependency from a task.
#[tauri::command]
pub async fn remove_task_dependency(
    pool: State<'_, DatabasePool>,
    task_id: i64,
    dependency: Dependency,
) -> Result<(), String> {
    TaskRepository::new(&pool)
        .remove_dependency(TaskId(task_id), dependency)
        .await
        .map_err(|error| error.to_string())
}

/// Lists all dependencies for a task.
#[tauri::command]
pub async fn list_task_dependencies(
    pool: State<'_, DatabasePool>,
    task_id: i64,
) -> Result<Vec<Dependency>, String> {
    TaskRepository::new(&pool)
        .list_dependencies(TaskId(task_id))
        .await
        .map_err(|error| error.to_string())
}

/// Creates a new goal.
#[tauri::command]
pub async fn create_goal(
    pool: State<'_, DatabasePool>,
    request: CreateGoalRequest,
) -> Result<Goal, String> {
    GoalRepository::new(&pool)
        .create(request)
        .await
        .map_err(|error| error.to_string())
}

/// Fetches a goal by id.
#[tauri::command]
pub async fn get_goal(pool: State<'_, DatabasePool>, id: i64) -> Result<Goal, String> {
    GoalRepository::new(&pool)
        .get(GoalId(id))
        .await
        .map_err(|error| error.to_string())
}

/// Lists all goals.
#[tauri::command]
pub async fn list_goals(pool: State<'_, DatabasePool>) -> Result<Vec<Goal>, String> {
    GoalRepository::new(&pool)
        .list()
        .await
        .map_err(|error| error.to_string())
}

/// Updates a goal.
#[tauri::command]
pub async fn update_goal(
    pool: State<'_, DatabasePool>,
    id: i64,
    request: UpdateGoalRequest,
) -> Result<Goal, String> {
    GoalRepository::new(&pool)
        .update(GoalId(id), request)
        .await
        .map_err(|error| error.to_string())
}

/// Deletes a goal.
#[tauri::command]
pub async fn delete_goal(pool: State<'_, DatabasePool>, id: i64) -> Result<(), String> {
    GoalRepository::new(&pool)
        .delete(GoalId(id))
        .await
        .map_err(|error| error.to_string())
}

/// Adds a tag to a task.
#[tauri::command]
pub async fn add_tag_to_task(
    pool: State<'_, DatabasePool>,
    task_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    TaskRepository::new(&pool)
        .add_tag(TaskId(task_id), tag_id)
        .await
        .map_err(|error| error.to_string())
}

/// Removes a tag from a task.
#[tauri::command]
pub async fn remove_tag_from_task(
    pool: State<'_, DatabasePool>,
    task_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    TaskRepository::new(&pool)
        .remove_tag(TaskId(task_id), tag_id)
        .await
        .map_err(|error| error.to_string())
}

/// Adds a tag to a goal.
#[tauri::command]
pub async fn add_tag_to_goal(
    pool: State<'_, DatabasePool>,
    goal_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    GoalRepository::new(&pool)
        .add_tag(GoalId(goal_id), tag_id)
        .await
        .map_err(|error| error.to_string())
}

/// Removes a tag from a goal.
#[tauri::command]
pub async fn remove_tag_from_goal(
    pool: State<'_, DatabasePool>,
    goal_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    GoalRepository::new(&pool)
        .remove_tag(GoalId(goal_id), tag_id)
        .await
        .map_err(|error| error.to_string())
}

/// Derives the scope lifecycle (Active / Overdue / Lapsed) of every Task and Goal at `now`
/// (local wall-clock). Nothing is persisted — the result is a pure function of scope, status,
/// and the reference instant.
#[tauri::command]
pub async fn derive_scope_lifecycles(
    pool: State<'_, DatabasePool>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<ItemLifecycle>, String> {
    derive_all_scope_lifecycles(&pool, now)
        .await
        .map_err(|error| error.to_string())
}
