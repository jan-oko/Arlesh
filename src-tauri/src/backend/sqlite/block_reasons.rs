//! [`SqliteBackend`]'s `block_reasons` operations: the in-process core over the local file.

use crate::{block_reasons::model::BlockReason, error::WireError};

use super::SqliteBackend;
use crate::backend::block_reasons::BlockReasonsPort;

#[async_trait::async_trait]
impl BlockReasonsPort for SqliteBackend {
    async fn list_all_block_reasons(&self) -> Result<Vec<BlockReason>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.block_reasons()
            .list_all()
            .await
            .map_err(WireError::from_error)
    }

    async fn set_block_reasons(
        &self,
        owner_type: String,
        owner_id: crate::nodes::id::NodeId,
        reasons: Vec<String>,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        crate::nodes::write::set_block_reasons(
            &mut db,
            &owner_type,
            &owner_id,
            &reasons,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }
}
