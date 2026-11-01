//! [`SqliteBackend`]'s `expectations` operations: the in-process core over the local file.

use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::model::{
        CreateExpectationRequest, Expectation, ExpectationId, SpawnedWait, TaskId,
        UpdateExpectationRequest, UpdateSpawnedWaitRequest,
    },
};

use super::SqliteBackend;
use crate::backend::expectations::WaitsPort;

#[async_trait::async_trait]
impl WaitsPort for SqliteBackend {
    async fn create_expectation(
        &self,
        request: CreateExpectationRequest,
    ) -> Result<Expectation, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let expectation = crate::nodes::write::create_expectation(
            &mut db,
            request,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(expectation)
    }

    async fn list_expectations(
        &self,
        now: chrono::NaiveDateTime,
    ) -> Result<Vec<Expectation>, WireError> {
        // A transaction only because the derivation reads through one; it writes nothing.
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let expectations = crate::mindmap::load(&mut db, now)
            .await
            .map_err(WireError::from_error)?
            .expectations;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(expectations)
    }

    async fn update_expectation(
        &self,
        id: NodeId,
        request: UpdateExpectationRequest,
    ) -> Result<Expectation, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let expectation = crate::nodes::write::update_expectation(
            &mut db,
            &id,
            request,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(expectation)
    }

    async fn complete_expectation_check(&self, id: i64) -> Result<Expectation, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let expectation = crate::tasks::complete_expectation_check(
            &mut db,
            ExpectationId(id),
            crate::tasks::expectations::now(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(expectation)
    }

    async fn update_spawned_wait(
        &self,
        task_id: i64,
        request: UpdateSpawnedWaitRequest,
    ) -> Result<SpawnedWait, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let wait = crate::tasks::waits::update_spawned_wait(&mut db, TaskId(task_id), request)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(wait)
    }

    async fn complete_spawned_wait_check(&self, task_id: i64) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        crate::tasks::waits::complete_spawned_check(
            &mut db,
            TaskId(task_id),
            crate::tasks::expectations::now(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn add_tag_to_expectation(
        &self,
        expectation_id: crate::nodes::id::NodeId,
        tag_id: i64,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        crate::nodes::write::set_tag(
            &mut db,
            "expectation",
            &expectation_id,
            tag_id,
            true,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn remove_tag_from_expectation(
        &self,
        expectation_id: crate::nodes::id::NodeId,
        tag_id: i64,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        crate::nodes::write::set_tag(
            &mut db,
            "expectation",
            &expectation_id,
            tag_id,
            false,
            chrono::Local::now().naive_local(),
        )
        .await
        .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn delete_expectation(&self, id: NodeId) -> Result<(), WireError> {
        // A Habit's wait item occurrence is archived, as every occurrence is; any other derived wait
        // goes with its Task: completing it again, or taking its template away.
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        crate::nodes::composite::delete_wait(&mut db, &id, chrono::Local::now().naive_local())
            .await?;
        db.commit().await.map_err(WireError::from_error)
    }

    async fn reopen_expectation_check(
        &self,
        id: i64,
        due_at: chrono::NaiveDateTime,
    ) -> Result<Expectation, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let expectation =
            crate::tasks::reopen_expectation_check(&mut db, ExpectationId(id), due_at)
                .await
                .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(expectation)
    }

    async fn reopen_spawned_wait_check(
        &self,
        task_id: i64,
        due_at: chrono::NaiveDateTime,
    ) -> Result<(), WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        crate::tasks::waits::reopen_spawned_check(&mut db, TaskId(task_id), due_at)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)
    }
}
