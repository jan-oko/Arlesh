//! Tauri commands for info node operations.

use tauri::State;

use crate::backend::AppBackend;
use crate::{
    duplicate::DuplicatedSubtree,
    error::WireError,
    infos::model::{CreateInfoRequest, Info, UpdateInfoRequest},
};

/// Creates a new info node.
///
/// A single `INSERT … RETURNING`, so it runs on a pooled session — SQLite gives the one write
/// statement-level atomicity on its own.
#[tauri::command]
pub async fn create_info(
    backend: State<'_, AppBackend>,
    request: CreateInfoRequest,
) -> Result<Info, WireError> {
    backend.create_info(request).await
}

/// Lists all info nodes.
#[tauri::command]
pub async fn list_infos(backend: State<'_, AppBackend>) -> Result<Vec<Info>, WireError> {
    backend.list_infos().await
}

/// Updates an info node.
///
/// Multi-statement (up to five conditional updates), so it runs on a transactional session:
/// without the [`commit`](crate::database::session::Db::commit) below, sqlx rolls the whole
/// update back when the session drops.
#[tauri::command]
pub async fn update_info(
    backend: State<'_, AppBackend>,
    id: i64,
    request: UpdateInfoRequest,
) -> Result<Info, WireError> {
    backend.update_info(id, request).await
}

/// Deletes an info node.
///
/// A single `DELETE`, so it runs on a pooled session.
#[tauri::command]
pub async fn delete_info(backend: State<'_, AppBackend>, id: i64) -> Result<(), WireError> {
    backend.delete_info(id).await
}

/// Deep-clones an info node and its whole subtree under `(target_type, target_id)`, putting the
/// new root at `position`. Backs the Mindmap's Copy+Paste.
///
/// Transactional: the subtree lands whole or not at all, Flows included. Returns the copy with
/// the rows hung on Habit occurrences that it could not carry, for the paste to name.
#[tauri::command]
pub async fn duplicate_info(
    backend: State<'_, AppBackend>,
    id: i64,
    target_type: String,
    target_id: i64,
    position: i64,
) -> Result<DuplicatedSubtree<Info>, WireError> {
    backend
        .duplicate_info(id, target_type, target_id, position)
        .await
}
