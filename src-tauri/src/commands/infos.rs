//! Tauri commands for info node operations.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    error::WireError,
    infos::model::{CreateInfoRequest, Info, InfoId, UpdateInfoRequest},
};

/// Creates a new info node.
///
/// A single `INSERT … RETURNING`, so it runs on a pooled session — SQLite gives the one write
/// statement-level atomicity on its own.
#[tauri::command]
pub async fn create_info(
    factory: State<'_, SessionFactory>,
    request: CreateInfoRequest,
) -> Result<Info, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.infos().create(request).await.map_err(WireError::from_error)
}

/// Lists all info nodes.
#[tauri::command]
pub async fn list_infos(factory: State<'_, SessionFactory>) -> Result<Vec<Info>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.infos().list().await.map_err(WireError::from_error)
}

/// Updates an info node.
///
/// Multi-statement (up to five conditional updates), so it runs on a transactional session:
/// without the [`commit`](crate::database::session::Db::commit) below, sqlx rolls the whole
/// update back when the session drops.
#[tauri::command]
pub async fn update_info(
    factory: State<'_, SessionFactory>,
    id: i64,
    request: UpdateInfoRequest,
) -> Result<Info, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let info = db
        .infos()
        .update(InfoId(id), request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(info)
}

/// Deletes an info node.
///
/// A single `DELETE`, so it runs on a pooled session.
#[tauri::command]
pub async fn delete_info(factory: State<'_, SessionFactory>, id: i64) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.infos()
        .delete(InfoId(id))
        .await
        .map_err(WireError::from_error)
}
