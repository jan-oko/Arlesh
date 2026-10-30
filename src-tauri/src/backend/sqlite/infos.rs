//! [`SqliteBackend`]'s `infos` operations: the in-process core over the local file.

use crate::{
    duplicate::{duplicate_subtree, DuplicableKind, DuplicatedSubtree},
    error::WireError,
    infos::model::{CreateInfoRequest, Info, InfoId, UpdateInfoRequest},
};

use super::SqliteBackend;
use crate::backend::infos::InfosPort;

#[async_trait::async_trait]
impl InfosPort for SqliteBackend {
    async fn create_info(&self, request: CreateInfoRequest) -> Result<Info, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let info =
            crate::nodes::write::create_info(&mut db, request, chrono::Local::now().naive_local())
                .await
                .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(info)
    }

    async fn list_infos(&self) -> Result<Vec<Info>, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.infos().list().await.map_err(WireError::from_error)
    }

    async fn update_info(&self, id: i64, request: UpdateInfoRequest) -> Result<Info, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let info = crate::nodes::write::update_info(
            &mut db,
            id,
            request,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(info)
    }

    async fn delete_info(&self, id: i64) -> Result<(), WireError> {
        // Transactional because it is two writes now: a note may be an added child of a Habit
        // occurrence, and the attachment naming it must not outlive the row it names.
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        crate::nodes::composite::delete_info(&mut db, id).await?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn duplicate_info(
        &self,
        id: i64,
        target_type: String,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Info>, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let subtree = duplicate_subtree(
            &mut db,
            DuplicableKind::Info,
            id,
            &target_type,
            target_id,
            position,
        )
        .await
        .map_err(WireError::from_error)?;
        let info = db
            .infos()
            .get(InfoId(subtree.root_id))
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(DuplicatedSubtree {
            copy: info,
            left_behind: subtree.left_behind,
        })
    }
}
