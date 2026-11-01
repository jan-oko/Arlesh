//! [`SqliteBackend`]'s `domains` operations: the in-process core over the local file.

use crate::{
    domains::model::{CreateDomainRequest, Domain, DomainId, DomainSubtype, UpdateDomainRequest},
    duplicate::{duplicate_subtree, DuplicableKind, DuplicatedSubtree},
    error::WireError,
};

use super::SqliteBackend;
use crate::backend::domains::DomainsPort;

#[async_trait::async_trait]
impl DomainsPort for SqliteBackend {
    async fn create_domain(&self, request: CreateDomainRequest) -> Result<Domain, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let domain = db
            .domains()
            .create(request)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(domain)
    }

    async fn get_domain(&self, id: i64) -> Result<Domain, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.domains()
            .get(DomainId(id))
            .await
            .map_err(WireError::from_error)
    }

    async fn list_domains(&self, subtype: Option<DomainSubtype>) -> Result<Vec<Domain>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.domains()
            .list(subtype)
            .await
            .map_err(WireError::from_error)
    }

    async fn update_domain(
        &self,
        id: i64,
        request: UpdateDomainRequest,
    ) -> Result<Domain, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.domains()
            .update(DomainId(id), request)
            .await
            .map_err(WireError::from_error)
    }

    async fn delete_domain(&self, id: i64) -> Result<(), WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.domains()
            .delete(DomainId(id))
            .await
            .map_err(WireError::from_error)
    }

    async fn duplicate_domain(
        &self,
        id: i64,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Domain>, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let subtree =
            duplicate_subtree(&mut db, DuplicableKind::Domain, id, "", target_id, position)
                .await
                .map_err(WireError::from_error)?;
        let domain = db
            .domains()
            .get(DomainId(subtree.root_id))
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(DuplicatedSubtree {
            copy: domain,
            left_behind: subtree.left_behind,
        })
    }
}
