//! The Tauri command for the mindmap's whole-tree load.

use tauri::State;

use crate::backend::AppBackend;
use crate::{error::WireError, mindmap::model::MindmapLoad};

/// Every payload one mindmap render needs, in a single round trip.
///
/// Replaces the `13 + 2N` calls the frontend used to make for `N` flows — the thirteen
/// resource-wide lists plus a per-flow iterations/statuses pair — which were paid again after
/// every edit.
///
/// What the board says about each node beyond its row — which dependencies block it, what it
/// inherits, its open question — and what the agents are doing come with it
/// ([`crate::mindmap::rules::facts`]), so the app reads them rather than working them out.
///
/// The agent capacity lock's block is derived onto it here (see [`crate::capacity::blocks`]), so
/// the board a window draws is blocked exactly as the MCP's is.
///
/// A read: it writes nothing, since every iteration window is derived from its value key (ADR
/// 0009). It runs in a transaction only so that its many reads see one consistent board.
#[tauri::command]
pub async fn load_mindmap(
    backend: State<'_, AppBackend>,
    now: chrono::NaiveDateTime,
) -> Result<MindmapLoad, WireError> {
    backend.load_mindmap(now).await
}
