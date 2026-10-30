//! The MCP roots: the commands behind the settings modal's *MCP access* page and the badge that
//! marks what the MCP can see.
//!
//! Root changes are ordinary board writes on the journal's ambient source, so the frontend's
//! per-command Gesture makes each one an undo step like any other edit.

use tauri::State;

pub use crate::backend::access::McpAccessCatalogue;
use crate::backend::AppBackend;
use crate::{
    access::model::{EffectiveAccess, NodeTable},
    error::WireError,
};

/// The MCP roots and every node that could be one.
///
/// One pooled session, two reads: the page is a settings surface, and a node created between the
/// two reads is picked up on the next open.
#[tauri::command]
pub async fn mcp_access_catalogue(
    backend: State<'_, AppBackend>,
) -> Result<McpAccessCatalogue, WireError> {
    backend.mcp_access_catalogue().await
}

/// Every stored node the MCP can see, with the root it is seen through.
///
/// Two pooled reads rather than a transaction: the board reloads this on every refresh, and a
/// badge a moment stale is put right by the next one, where a writer lock on every reload would
/// queue behind every write.
#[tauri::command]
pub async fn list_mcp_access(
    backend: State<'_, AppBackend>,
) -> Result<Vec<EffectiveAccess>, WireError> {
    backend.list_mcp_access().await
}

/// Makes one stored node an MCP root.
///
/// Transactional: the node's existence is checked before the write, and per ADR-0004 a
/// check-then-write belongs on one — without it the node could be deleted in between and leave a
/// root on nothing.
#[tauri::command]
pub async fn add_mcp_root(
    backend: State<'_, AppBackend>,
    node_kind: NodeTable,
    node_id: i64,
) -> Result<(), WireError> {
    backend.add_mcp_root(node_kind, node_id).await
}

/// Stops one node being an MCP root.
#[tauri::command]
pub async fn remove_mcp_root(
    backend: State<'_, AppBackend>,
    node_kind: NodeTable,
    node_id: i64,
) -> Result<(), WireError> {
    backend.remove_mcp_root(node_kind, node_id).await
}
