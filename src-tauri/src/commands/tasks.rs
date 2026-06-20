//! Tauri commands for task and goal operations.

use tauri::State;

use crate::{
    db::DbPool,
    tasks::{
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, Goal, GoalId, Task, TaskId,
            TaskWithBlockers, UpdateGoalRequest, UpdateTaskRequest,
        },
        GoalRepository, TaskRepository,
    },
};

/// Creates a new task.
#[tauri::command]
pub async fn create_task(
    pool: State<'_, DbPool>,
    req: CreateTaskRequest,
) -> Result<Task, String> {
    TaskRepository::new(&pool)
        .create(req)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches a task by id with computed blockers.
#[tauri::command]
pub async fn get_task(
    pool: State<'_, DbPool>,
    id: i64,
) -> Result<TaskWithBlockers, String> {
    TaskRepository::new(&pool)
        .get_with_blockers(TaskId(id))
        .await
        .map_err(|e| e.to_string())
}

/// Lists all tasks.
#[tauri::command]
pub async fn list_tasks(pool: State<'_, DbPool>) -> Result<Vec<Task>, String> {
    TaskRepository::new(&pool)
        .list()
        .await
        .map_err(|e| e.to_string())
}

/// Updates a task.
#[tauri::command]
pub async fn update_task(
    pool: State<'_, DbPool>,
    id: i64,
    req: UpdateTaskRequest,
) -> Result<Task, String> {
    TaskRepository::new(&pool)
        .update(TaskId(id), req)
        .await
        .map_err(|e| e.to_string())
}

/// Deletes a task.
#[tauri::command]
pub async fn delete_task(pool: State<'_, DbPool>, id: i64) -> Result<(), String> {
    TaskRepository::new(&pool)
        .delete(TaskId(id))
        .await
        .map_err(|e| e.to_string())
}

/// Adds a dependency to a task.
#[tauri::command]
pub async fn add_task_dependency(
    pool: State<'_, DbPool>,
    task_id: i64,
    dep: Dependency,
) -> Result<(), String> {
    TaskRepository::new(&pool)
        .add_dependency(TaskId(task_id), dep)
        .await
        .map_err(|e| e.to_string())
}

/// Removes a dependency from a task.
#[tauri::command]
pub async fn remove_task_dependency(
    pool: State<'_, DbPool>,
    task_id: i64,
    dep: Dependency,
) -> Result<(), String> {
    TaskRepository::new(&pool)
        .remove_dependency(TaskId(task_id), dep)
        .await
        .map_err(|e| e.to_string())
}

/// Creates a new goal.
#[tauri::command]
pub async fn create_goal(
    pool: State<'_, DbPool>,
    req: CreateGoalRequest,
) -> Result<Goal, String> {
    GoalRepository::new(&pool)
        .create(req)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches a goal by id.
#[tauri::command]
pub async fn get_goal(pool: State<'_, DbPool>, id: i64) -> Result<Goal, String> {
    GoalRepository::new(&pool)
        .get(GoalId(id))
        .await
        .map_err(|e| e.to_string())
}

/// Lists all goals.
#[tauri::command]
pub async fn list_goals(pool: State<'_, DbPool>) -> Result<Vec<Goal>, String> {
    GoalRepository::new(&pool)
        .list()
        .await
        .map_err(|e| e.to_string())
}

/// Updates a goal.
#[tauri::command]
pub async fn update_goal(
    pool: State<'_, DbPool>,
    id: i64,
    req: UpdateGoalRequest,
) -> Result<Goal, String> {
    GoalRepository::new(&pool)
        .update(GoalId(id), req)
        .await
        .map_err(|e| e.to_string())
}

/// Deletes a goal.
#[tauri::command]
pub async fn delete_goal(pool: State<'_, DbPool>, id: i64) -> Result<(), String> {
    GoalRepository::new(&pool)
        .delete(GoalId(id))
        .await
        .map_err(|e| e.to_string())
}
