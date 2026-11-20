//! The `domains` part of the [`Backend`](super::Backend) port: what the commands in
//! the app's `domains` commands ask of whichever backend the app runs on.

use arlesh_core::nodes::id::RowId;
use arlesh_core::{
    domains::model::{CreateDomainRequest, Domain, DomainSubtype, UpdateDomainRequest},
    duplicate::DuplicatedSubtree,
    error::WireError,
};

/// The `domains` operations a backend serves.
#[async_trait::async_trait]
pub trait DomainsPort: Send + Sync {
    /// Creates a new domain (Project, Domain, or Tag).
    async fn create_domain(&self, request: CreateDomainRequest) -> Result<Domain, WireError>;

    /// Fetches a domain by id.
    async fn get_domain(&self, id: RowId) -> Result<Domain, WireError>;

    /// Lists all domains, optionally filtered by subtype.
    async fn list_domains(&self, subtype: Option<DomainSubtype>) -> Result<Vec<Domain>, WireError>;

    /// Updates an existing domain.
    async fn update_domain(
        &self,
        id: RowId,
        request: UpdateDomainRequest,
    ) -> Result<Domain, WireError>;

    /// Deletes a domain by id.
    async fn delete_domain(&self, id: RowId) -> Result<(), WireError>;

    /// Deep-clones a Project, Domain or Tag and its whole subtree under `target_id`, putting the new
    async fn duplicate_domain(
        &self,
        id: RowId,
        target_id: RowId,
        position: i64,
    ) -> Result<DuplicatedSubtree<Domain>, WireError>;
}
