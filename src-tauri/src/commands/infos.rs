//! Tauri commands for info node operations.

use tauri::State;

use crate::{
    database::DatabasePool,
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
) -> Result<Info, String> {
    InfoRepository::new(&pool)
        .create(request)
        .await
        .map_err(|error| error.to_string())
}

/// Lists all info nodes.
#[tauri::command]
pub async fn list_infos(pool: State<'_, DatabasePool>) -> Result<Vec<Info>, String> {
    InfoRepository::new(&pool)
        .list()
        .await
        .map_err(|error| error.to_string())
}

/// Updates an info node.
#[tauri::command]
pub async fn update_info(
    pool: State<'_, DatabasePool>,
    id: i64,
    request: UpdateInfoRequest,
) -> Result<Info, String> {
    InfoRepository::new(&pool)
        .update(InfoId(id), request)
        .await
        .map_err(|error| error.to_string())
}

/// Deletes an info node.
#[tauri::command]
pub async fn delete_info(pool: State<'_, DatabasePool>, id: i64) -> Result<(), String> {
    InfoRepository::new(&pool)
        .delete(InfoId(id))
        .await
        .map_err(|error| error.to_string())
}
