//! The `block_reasons` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::block_reasons`] ask of whichever backend the app runs on.

use crate::{block_reasons::model::BlockReason, error::WireError};

/// The `block_reasons` operations a backend serves.
#[async_trait::async_trait]
pub trait BlockReasonsPort: Send + Sync {
    /// Lists every block reason across all tasks and goals (for the mindmap bulk load).
    async fn list_all_block_reasons(&self) -> Result<Vec<BlockReason>, WireError>;

    /// Replaces the ordered block-reason list for one owner (`owner_type` is `task` or `goal`).
    async fn set_block_reasons(
        &self,
        owner_type: String,
        owner_id: crate::nodes::id::NodeId,
        reasons: Vec<String>,
    ) -> Result<(), WireError>;
}
