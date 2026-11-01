//! Tauri commands for the block-reason list of tasks and goals.

use tauri::State;

use crate::backend::AppBackend;
use crate::{block_reasons::model::BlockReason, error::WireError};

/// Lists every block reason across all tasks and goals (for the mindmap bulk load).
#[tauri::command]
pub async fn list_all_block_reasons(
    backend: State<'_, AppBackend>,
) -> Result<Vec<BlockReason>, WireError> {
    backend.list_all_block_reasons().await
}

/// Replaces the ordered block-reason list for one owner (`owner_type` is `task` or `goal`).
///
/// Multi-statement, so it runs on a transactional session: without the [`commit`](crate::database::session::Db::commit)
/// below, sqlx rolls the whole replacement back when the session drops.
#[tauri::command]
pub async fn set_block_reasons(
    backend: State<'_, AppBackend>,
    owner_type: String,
    owner_id: crate::nodes::id::NodeId,
    reasons: Vec<String>,
) -> Result<(), WireError> {
    backend
        .set_block_reasons(owner_type, owner_id, reasons)
        .await
}
