//! Tauri commands for the block-reason list of tasks and goals.

use tauri::State;

use crate::{
    block_reasons::{model::BlockReason, BlockReasonRepository},
    database::DatabasePool,
    error::WireError,
};

/// Lists every block reason across all tasks and goals (for the mindmap bulk load).
#[tauri::command]
pub async fn list_all_block_reasons(pool: State<'_, DatabasePool>) -> Result<Vec<BlockReason>, WireError> {
    BlockReasonRepository::new(&pool)
        .list_all()
        .await
        .map_err(WireError::from_error)
}

/// Replaces the ordered block-reason list for one owner (`owner_type` is `task` or `goal`).
#[tauri::command]
pub async fn set_block_reasons(
    pool: State<'_, DatabasePool>,
    owner_type: String,
    owner_id: i64,
    reasons: Vec<String>,
) -> Result<(), WireError> {
    BlockReasonRepository::new(&pool)
        .set(&owner_type, owner_id, &reasons)
        .await
        .map_err(WireError::from_error)
}
