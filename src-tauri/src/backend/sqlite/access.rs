//! [`SqliteBackend`]'s `access` operations: the in-process core over the local file.

use crate::{
    access::{
        self,
        model::{EffectiveAccess, NodeKey, NodeTable},
    },
    error::WireError,
};

use super::SqliteBackend;
use crate::backend::access::{AccessPort, McpAccessCatalogue};

#[async_trait::async_trait]
impl AccessPort for SqliteBackend {
    async fn mcp_access_catalogue(&self) -> Result<McpAccessCatalogue, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        let roots = db.access().roots().await.map_err(WireError::from_error)?;
        let nodes = db
            .access()
            .catalogue()
            .await
            .map_err(WireError::from_error)?;
        let candidates = crate::access::resolve::root_candidates(&roots, &nodes);
        Ok(McpAccessCatalogue {
            roots,
            nodes,
            candidates,
        })
    }

    async fn list_mcp_access(&self) -> Result<Vec<EffectiveAccess>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        let map = access::access_map(&mut db)
            .await
            .map_err(WireError::from_error)?;
        Ok(map.effective())
    }

    async fn add_mcp_root(&self, node_kind: NodeTable, node_id: i64) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        db.access()
            .add_root(NodeKey::new(node_kind, node_id))
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(())
    }

    async fn remove_mcp_root(&self, node_kind: NodeTable, node_id: i64) -> Result<(), WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.access()
            .remove_root(NodeKey::new(node_kind, node_id))
            .await
            .map_err(WireError::from_error)?;
        Ok(())
    }
}
