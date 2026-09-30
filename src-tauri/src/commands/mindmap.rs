//! The Tauri command for the mindmap's whole-tree load.

use tauri::State;

use crate::{
    capacity::{blocks, AgentCapacity},
    database::session::SessionFactory,
    error::WireError,
    mindmap,
    mindmap::model::MindmapLoad,
};

/// Every payload one mindmap render needs, in a single round trip.
///
/// Replaces the `13 + 2N` calls the frontend used to make for `N` flows — the thirteen
/// resource-wide lists plus a per-flow iterations/statuses pair — which were paid again after
/// every edit.
///
/// The agent capacity lock's block is derived onto it here (see [`crate::capacity::blocks`]), so
/// the board a window draws is blocked exactly as the MCP's is.
///
/// A read: it writes nothing, since every iteration window is derived from its value key (ADR
/// 0009). It runs in a transaction only so that its many reads see one consistent board.
#[tauri::command]
pub async fn load_mindmap(
    factory: State<'_, SessionFactory>,
    capacity: State<'_, AgentCapacity>,
    now: chrono::NaiveDateTime,
) -> Result<MindmapLoad, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let mut load = mindmap::load(&mut db, now)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    blocks::apply(&mut load, capacity.get().await.at_capacity);
    Ok(load)
}
