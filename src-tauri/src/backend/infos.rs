//! The `infos` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::infos`] ask of whichever backend the app runs on.

use crate::{
    duplicate::DuplicatedSubtree,
    error::WireError,
    infos::model::{CreateInfoRequest, Info, UpdateInfoRequest},
};

/// The `infos` operations a backend serves.
#[async_trait::async_trait]
pub trait InfosPort: Send + Sync {
    /// Creates a new info node.
    async fn create_info(&self, request: CreateInfoRequest) -> Result<Info, WireError>;

    /// Lists all info nodes.
    async fn list_infos(&self) -> Result<Vec<Info>, WireError>;

    /// Updates an info node.
    async fn update_info(&self, id: i64, request: UpdateInfoRequest) -> Result<Info, WireError>;

    /// Deletes an info node.
    async fn delete_info(&self, id: i64) -> Result<(), WireError>;

    /// Deep-clones an info node and its whole subtree under `(target_type, target_id)`, putting the
    async fn duplicate_info(
        &self,
        id: i64,
        target_type: String,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Info>, WireError>;
}
