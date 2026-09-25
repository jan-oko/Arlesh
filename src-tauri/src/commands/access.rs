//! The MCP roots: the commands behind the settings modal's *MCP access* page and the badge that
//! marks what the MCP can see.
//!
//! Root changes are ordinary board writes on the journal's ambient source, so the frontend's
//! per-command Gesture makes each one an undo step like any other edit.

use serde::Serialize;
use tauri::State;

use crate::{
    access::{
        self,
        model::{CatalogueNode, EffectiveAccess, NodeKey, NodeTable},
    },
    database::session::SessionFactory,
    error::WireError,
};

/// What the *MCP access* page lists: the roots, and every stored node one could be.
#[derive(Debug, Clone, Serialize)]
pub struct McpAccessCatalogue {
    /// Every MCP root, in node order.
    pub roots: Vec<NodeKey>,
    /// Every stored node, with its title and where it hangs — what the page's node search
    /// searches, and what names a root and spells its path.
    pub nodes: Vec<CatalogueNode>,
}

/// The MCP roots and every node that could be one.
///
/// One pooled session, two reads: the page is a settings surface, and a node created between the
/// two reads is picked up on the next open.
#[tauri::command]
pub async fn mcp_access_catalogue(
    factory: State<'_, SessionFactory>,
) -> Result<McpAccessCatalogue, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    let roots = db.access().roots().await.map_err(WireError::from_error)?;
    let nodes = db
        .access()
        .catalogue()
        .await
        .map_err(WireError::from_error)?;
    Ok(McpAccessCatalogue { roots, nodes })
}

/// Every stored node the MCP can see, with the root it is seen through.
///
/// Two pooled reads rather than a transaction: the board reloads this on every refresh, and a
/// badge a moment stale is put right by the next one, where a writer lock on every reload would
/// queue behind every write.
#[tauri::command]
pub async fn list_mcp_access(
    factory: State<'_, SessionFactory>,
) -> Result<Vec<EffectiveAccess>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    let map = access::access_map(&mut db)
        .await
        .map_err(WireError::from_error)?;
    Ok(map.effective())
}

/// Makes one stored node an MCP root.
///
/// Transactional: the node's existence is checked before the write, and per ADR-0004 a
/// check-then-write belongs on one — without it the node could be deleted in between and leave a
/// root on nothing.
#[tauri::command]
pub async fn add_mcp_root(
    factory: State<'_, SessionFactory>,
    node_kind: NodeTable,
    node_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    db.access()
        .add_root(NodeKey::new(node_kind, node_id))
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(())
}

/// Stops one node being an MCP root.
#[tauri::command]
pub async fn remove_mcp_root(
    factory: State<'_, SessionFactory>,
    node_kind: NodeTable,
    node_id: i64,
) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.access()
        .remove_root(NodeKey::new(node_kind, node_id))
        .await
        .map_err(WireError::from_error)?;
    Ok(())
}
