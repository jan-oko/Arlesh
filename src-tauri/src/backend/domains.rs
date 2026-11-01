//! The `domains` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::domains`] ask of whichever backend the app runs on.

use crate::{
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
    async fn get_domain(&self, id: i64) -> Result<Domain, WireError>;

    /// Lists all domains, optionally filtered by subtype.
    async fn list_domains(&self, subtype: Option<DomainSubtype>) -> Result<Vec<Domain>, WireError>;

    /// Updates an existing domain.
    async fn update_domain(
        &self,
        id: i64,
        request: UpdateDomainRequest,
    ) -> Result<Domain, WireError>;

    /// Deletes a domain by id.
    async fn delete_domain(&self, id: i64) -> Result<(), WireError>;

    /// Deep-clones a Project, Domain or Tag and its whole subtree under `target_id`, putting the new
    async fn duplicate_domain(
        &self,
        id: i64,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Domain>, WireError>;
}
