//! Tauri commands for the block-reason list of tasks and goals.

use tauri::State;

use crate::{
    block_reasons::model::BlockReason, database::session::SessionFactory, error::WireError,
};

/// Lists every block reason across all tasks and goals (for the mindmap bulk load).
#[tauri::command]
pub async fn list_all_block_reasons(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<BlockReason>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.block_reasons()
        .list_all()
        .await
        .map_err(WireError::from_error)
}

/// Replaces the ordered block-reason list for one owner (`owner_type` is `task` or `goal`).
///
/// Multi-statement, so it runs on a transactional session: without the [`commit`](crate::database::session::Db::commit)
/// below, sqlx rolls the whole replacement back when the session drops.
#[tauri::command]
pub async fn set_block_reasons(
    factory: State<'_, SessionFactory>,
    owner_type: String,
    owner_id: i64,
    reasons: Vec<String>,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    db.block_reasons()
        .set(&owner_type, owner_id, &reasons)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)
}
