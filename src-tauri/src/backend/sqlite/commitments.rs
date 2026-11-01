//! [`SqliteBackend`]'s `commitments` operations: the in-process core over the local file.

use crate::{
    error::WireError,
    nodes::{id::NodeId, write},
    tasks::model::{Commitment, CommitmentId, CreateCommitmentRequest, UpdateCommitmentRequest},
};

use super::SqliteBackend;
use crate::backend::commitments::CommitmentsPort;

#[async_trait::async_trait]
impl CommitmentsPort for SqliteBackend {
    async fn create_commitment(
        &self,
        request: CreateCommitmentRequest,
    ) -> Result<Commitment, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let commitment =
            write::create_commitment(&mut db, request, chrono::Local::now().naive_local())
                .await
                .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(commitment)
    }

    async fn get_commitment(&self, id: i64) -> Result<Commitment, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.commitments()
            .get(CommitmentId(id))
            .await
            .map_err(WireError::from_error)
    }

    async fn list_commitments(
        &self,
        now: chrono::NaiveDateTime,
    ) -> Result<Vec<Commitment>, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let load = crate::mindmap::load(&mut db, now)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(load.commitments)
    }

    async fn update_commitment(
        &self,
        id: NodeId,
        request: UpdateCommitmentRequest,
    ) -> Result<Commitment, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let commitment =
            write::update_commitment(&mut db, &id, request, chrono::Local::now().naive_local())
                .await
                .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(commitment)
    }

    async fn delete_commitment(&self, id: NodeId) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::delete(
            &mut db,
            "commitment",
            &id,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn add_tag_to_commitment(
        &self,
        commitment_id: NodeId,
        tag_id: i64,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::set_tag(
            &mut db,
            "commitment",
            &commitment_id,
            tag_id,
            true,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn remove_tag_from_commitment(
        &self,
        commitment_id: NodeId,
        tag_id: i64,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        write::set_tag(
            &mut db,
            "commitment",
            &commitment_id,
            tag_id,
            false,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }
}
