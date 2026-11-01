//! The Tauri command for the mindmap's whole-tree load.

use tauri::State;

use crate::backend::AppBackend;
use crate::{backend::revision::BoardLoad, error::WireError};

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
/// In Client mode it carries the `revision` the server read the board at, which the window keeps
/// to tell which `board-changed` events are news (`src/stores/board-revision-store.ts`).
///
/// A read: it writes nothing, since every iteration window is derived from its value key (ADR
/// 0009). It runs in a transaction only so that its many reads see one consistent board.
#[tauri::command]
pub async fn load_mindmap(
    backend: State<'_, AppBackend>,
    now: chrono::NaiveDateTime,
) -> Result<BoardLoad, WireError> {
    backend.load_mindmap(now).await
}
