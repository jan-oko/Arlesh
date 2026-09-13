//! Tauri commands for info node operations.

use tauri::State;

use crate::{
    database::DatabasePool,
    error::WireError,
    infos::{
        model::{CreateInfoRequest, Info, InfoId, UpdateInfoRequest},
        InfoRepository,
    },
};

/// Creates a new info node.
#[tauri::command]
pub async fn create_info(
    pool: State<'_, DatabasePool>,
    request: CreateInfoRequest,
) -> Result<Info, WireError> {
    InfoRepository::new(&pool)
        .create(request)
        .await
        .map_err(WireError::from_error)
}

/// Lists all info nodes.
#[tauri::command]
pub async fn list_infos(pool: State<'_, DatabasePool>) -> Result<Vec<Info>, WireError> {
    InfoRepository::new(&pool)
        .list()
        .await
        .map_err(WireError::from_error)
}

/// Updates an info node.
#[tauri::command]
pub async fn update_info(
    pool: State<'_, DatabasePool>,
    id: i64,
    request: UpdateInfoRequest,
) -> Result<Info, WireError> {
    InfoRepository::new(&pool)
        .update(InfoId(id), request)
        .await
        .map_err(WireError::from_error)
}

/// Deletes an info node.
#[tauri::command]
pub async fn delete_info(pool: State<'_, DatabasePool>, id: i64) -> Result<(), WireError> {
    InfoRepository::new(&pool)
        .delete(InfoId(id))
        .await
        .map_err(WireError::from_error)
}
