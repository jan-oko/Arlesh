//! The `expectations` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::expectations`] ask of whichever backend the app runs on.

use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::model::{
        CreateExpectationRequest, Expectation, SpawnedWait, UpdateExpectationRequest,
        UpdateSpawnedWaitRequest,
    },
};

/// The `expectations` operations a backend serves.
#[async_trait::async_trait]
pub trait WaitsPort: Send + Sync {
    /// Creates a new expectation: pending, live, with the Check every the request names, if any.
    async fn create_expectation(
        &self,
        request: CreateExpectationRequest,
    ) -> Result<Expectation, WireError>;

    /// Lists every expectation at `now`, stored and derived — the Expectation virtual table.
    async fn list_expectations(
        &self,
        now: chrono::NaiveDateTime,
    ) -> Result<Vec<Expectation>, WireError>;

    /// Updates an expectation — including releasing it, or taking a release back.
    async fn update_expectation(
        &self,
        id: NodeId,
        request: UpdateExpectationRequest,
    ) -> Result<Expectation, WireError>;

    /// Completes the current check on a stored expectation: records now as its last check, so the
    async fn complete_expectation_check(&self, id: i64) -> Result<Expectation, WireError>;

    /// Releases, un-releases or archives the wait a task's completion spawned.
    async fn update_spawned_wait(
        &self,
        task_id: i64,
        request: UpdateSpawnedWaitRequest,
    ) -> Result<SpawnedWait, WireError>;

    /// Completes the current check on a task's spawned wait.
    async fn complete_spawned_wait_check(&self, task_id: i64) -> Result<(), WireError>;

    /// Adds a tag to an expectation.
    async fn add_tag_to_expectation(
        &self,
        expectation_id: crate::nodes::id::NodeId,
        tag_id: i64,
    ) -> Result<(), WireError>;

    /// Removes a tag from an expectation.
    async fn remove_tag_from_expectation(
        &self,
        expectation_id: crate::nodes::id::NodeId,
        tag_id: i64,
    ) -> Result<(), WireError>;

    /// Deletes an expectation, its notes, and every dependency edge aimed at it.
    async fn delete_expectation(&self, id: NodeId) -> Result<(), WireError>;

    /// Takes the latest completed check on a stored wait back. `due_at` names the check, as the
    async fn reopen_expectation_check(
        &self,
        id: i64,
        due_at: chrono::NaiveDateTime,
    ) -> Result<Expectation, WireError>;

    /// Takes the latest completed check on a task's spawned wait back.
    async fn reopen_spawned_wait_check(
        &self,
        task_id: i64,
        due_at: chrono::NaiveDateTime,
    ) -> Result<(), WireError>;
}
