//! The `access` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::access`] ask of whichever backend the app runs on.

use crate::{
    access::model::{CatalogueNode, EffectiveAccess, NodeKey, NodeTable},
    error::WireError,
};
use serde::Serialize;

/// What the *MCP access* page lists: the roots, and every stored node one could be.
#[derive(Debug, Clone, Serialize)]
pub struct McpAccessCatalogue {
    /// Every MCP root, in node order.
    pub roots: Vec<NodeKey>,
    /// Every stored node, with its title and where it hangs — what names a root and spells its
    /// path, and the candidates' titles.
    pub nodes: Vec<CatalogueNode>,
    /// The nodes that may be made roots — what the page's node search searches
    /// ([`crate::access::resolve::root_candidates`]).
    pub candidates: Vec<NodeKey>,
}

/// The `access` operations a backend serves.
#[async_trait::async_trait]
pub trait AccessPort: Send + Sync {
    /// The MCP roots and every node that could be one.
    async fn mcp_access_catalogue(&self) -> Result<McpAccessCatalogue, WireError>;

    /// Every stored node the MCP can see, with the root it is seen through.
    async fn list_mcp_access(&self) -> Result<Vec<EffectiveAccess>, WireError>;

    /// Makes one stored node an MCP root.
    async fn add_mcp_root(&self, node_kind: NodeTable, node_id: i64) -> Result<(), WireError>;

    /// Stops one node being an MCP root.
    async fn remove_mcp_root(&self, node_kind: NodeTable, node_id: i64) -> Result<(), WireError>;
}
