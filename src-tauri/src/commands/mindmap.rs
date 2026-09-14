//! The Tauri command for the mindmap's whole-tree load.

use tauri::State;

use crate::{
    database::session::SessionFactory, error::WireError, mindmap, mindmap::model::MindmapLoad,
};

/// Every payload one mindmap render needs, in a single round trip.
///
/// Replaces the `13 + 2N` calls the frontend used to make for `N` flows — the thirteen
/// resource-wide lists plus a per-flow iterations/statuses pair — which were paid again after
/// every edit.
///
/// Transactional despite reading like a query: deriving a Habit's iterations materialises the
/// scope rows its windows land on, so the load writes. Without the
/// [`commit`](crate::database::session::Db::commit) below, sqlx discards those scopes when the
/// session drops — and still returns `Ok`, which is why `tests/mindmap_commands.rs` asserts on
/// rows rather than on the result. See ADR-0004.
#[tauri::command]
pub async fn load_mindmap(
    factory: State<'_, SessionFactory>,
    now: chrono::NaiveDateTime,
) -> Result<MindmapLoad, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let load = mindmap::load(&mut db, now)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(load)
}
