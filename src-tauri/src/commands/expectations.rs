//! Tauri commands for expectation operations.
//!
//! Thin, like every other command module: open a session, delegate, commit. Releasing and taking
//! a release back are ordinary [`update_expectation`] writes of the status — on a stored wait or a
//! Task's spawned one alike. A wait's check tasks are Task rows, completed by `update_task`; the
//! check commands here remain for callers that name the wait instead.

use tauri::State;

use crate::backend::AppBackend;
use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::model::{
        CreateExpectationRequest, Expectation, SpawnedWait, UpdateExpectationRequest,
        UpdateSpawnedWaitRequest,
    },
};

/// Creates a new expectation: pending, live, with the Check every the request names, if any.
#[tauri::command]
pub async fn create_expectation(
    backend: State<'_, AppBackend>,
    request: CreateExpectationRequest,
) -> Result<Expectation, WireError> {
    backend.create_expectation(request).await
}

/// Lists every expectation at `now`, stored and derived — the Expectation virtual table.
#[tauri::command]
pub async fn list_expectations(
    backend: State<'_, AppBackend>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<Expectation>, WireError> {
    backend.list_expectations(now).await
}

/// Updates an expectation — including releasing it, or taking a release back.
#[tauri::command]
pub async fn update_expectation(
    backend: State<'_, AppBackend>,
    id: NodeId,
    request: UpdateExpectationRequest,
) -> Result<Expectation, WireError> {
    backend.update_expectation(id, request).await
}

/// Completes the current check on a stored expectation: records now as its last check, so the
/// next falls due one interval later. The wait stays pending.
#[tauri::command]
pub async fn complete_expectation_check(
    backend: State<'_, AppBackend>,
    id: i64,
) -> Result<Expectation, WireError> {
    backend.complete_expectation_check(id).await
}

/// Releases, un-releases or archives the wait a task's completion spawned.
#[tauri::command]
pub async fn update_spawned_wait(
    backend: State<'_, AppBackend>,
    task_id: i64,
    request: UpdateSpawnedWaitRequest,
) -> Result<SpawnedWait, WireError> {
    backend.update_spawned_wait(task_id, request).await
}

/// Completes the current check on a task's spawned wait.
#[tauri::command]
pub async fn complete_spawned_wait_check(
    backend: State<'_, AppBackend>,
    task_id: i64,
) -> Result<(), WireError> {
    backend.complete_spawned_wait_check(task_id).await
}

/// Adds a tag to an expectation.
#[tauri::command]
pub async fn add_tag_to_expectation(
    backend: State<'_, AppBackend>,
    expectation_id: crate::nodes::id::NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    backend.add_tag_to_expectation(expectation_id, tag_id).await
}

/// Removes a tag from an expectation.
#[tauri::command]
pub async fn remove_tag_from_expectation(
    backend: State<'_, AppBackend>,
    expectation_id: crate::nodes::id::NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    backend
        .remove_tag_from_expectation(expectation_id, tag_id)
        .await
}

/// Deletes an expectation, its notes, and every dependency edge aimed at it.
#[tauri::command]
pub async fn delete_expectation(
    backend: State<'_, AppBackend>,
    id: NodeId,
) -> Result<(), WireError> {
    backend.delete_expectation(id).await
}

/// Takes the latest completed check on a stored wait back. `due_at` names the check, as the
/// frontend drew it (`YYYY-MM-DDTHH:MM:SS`).
#[tauri::command]
pub async fn reopen_expectation_check(
    backend: State<'_, AppBackend>,
    id: i64,
    due_at: chrono::NaiveDateTime,
) -> Result<Expectation, WireError> {
    backend.reopen_expectation_check(id, due_at).await
}

/// Takes the latest completed check on a task's spawned wait back.
#[tauri::command]
pub async fn reopen_spawned_wait_check(
    backend: State<'_, AppBackend>,
    task_id: i64,
    due_at: chrono::NaiveDateTime,
) -> Result<(), WireError> {
    backend.reopen_spawned_wait_check(task_id, due_at).await
}
