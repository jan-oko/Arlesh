//! Tauri commands for commitment operations.
//!
//! Thin, like every other command module: open a session, delegate, commit. Note that there is
//! no `set_verdict` command — recording, changing and clearing a verdict are all one ordinary
//! [`update_commitment`] write, so a misclick is undone by the same call that made it.

use tauri::State;

use crate::backend::AppBackend;
use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::model::{Commitment, CreateCommitmentRequest, UpdateCommitmentRequest},
};

/// Creates a new commitment.
///
/// Refused when the commitment would have no effective Time Scope — neither its own nor a scoped
/// ancestor's. That is the one write rule unique to this kind: a rule held over no window has
/// nothing to be kept or broken over.
#[tauri::command]
pub async fn create_commitment(
    backend: State<'_, AppBackend>,
    request: CreateCommitmentRequest,
) -> Result<Commitment, WireError> {
    backend.create_commitment(request).await
}

/// Fetches a commitment by id.
#[tauri::command]
pub async fn get_commitment(
    backend: State<'_, AppBackend>,
    id: i64,
) -> Result<Commitment, WireError> {
    backend.get_commitment(id).await
}

/// Lists every commitment — the Commitment virtual table: stored rows and every commitment
/// Habit's iterations.
#[tauri::command]
pub async fn list_commitments(
    backend: State<'_, AppBackend>,
    now: chrono::NaiveDateTime,
) -> Result<Vec<Commitment>, WireError> {
    backend.list_commitments(now).await
}

/// Updates a commitment, stored or derived — including recording, changing or clearing its
/// Verdict.
#[tauri::command]
pub async fn update_commitment(
    backend: State<'_, AppBackend>,
    id: NodeId,
    request: UpdateCommitmentRequest,
) -> Result<Commitment, WireError> {
    backend.update_commitment(id, request).await
}

/// Deletes a commitment and everything beneath it — or archives a commitment Habit's iteration,
/// which is never deleted.
#[tauri::command]
pub async fn delete_commitment(
    backend: State<'_, AppBackend>,
    id: NodeId,
) -> Result<(), WireError> {
    backend.delete_commitment(id).await
}

/// Adds a tag to a commitment.
#[tauri::command]
pub async fn add_tag_to_commitment(
    backend: State<'_, AppBackend>,
    commitment_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    backend.add_tag_to_commitment(commitment_id, tag_id).await
}

/// Removes a tag from a commitment.
#[tauri::command]
pub async fn remove_tag_from_commitment(
    backend: State<'_, AppBackend>,
    commitment_id: NodeId,
    tag_id: i64,
) -> Result<(), WireError> {
    backend
        .remove_tag_from_commitment(commitment_id, tag_id)
        .await
}
