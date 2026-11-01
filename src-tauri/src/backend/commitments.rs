//! The `commitments` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::commitments`] ask of whichever backend the app runs on.

use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::model::{Commitment, CreateCommitmentRequest, UpdateCommitmentRequest},
};

/// The `commitments` operations a backend serves.
#[async_trait::async_trait]
pub trait CommitmentsPort: Send + Sync {
    /// Creates a new commitment.
    async fn create_commitment(
        &self,
        request: CreateCommitmentRequest,
    ) -> Result<Commitment, WireError>;

    /// Fetches a commitment by id.
    async fn get_commitment(&self, id: i64) -> Result<Commitment, WireError>;

    /// Lists every commitment — the Commitment virtual table: stored rows and every commitment
    async fn list_commitments(
        &self,
        now: chrono::NaiveDateTime,
    ) -> Result<Vec<Commitment>, WireError>;

    /// Updates a commitment, stored or derived — including recording, changing or clearing its
    async fn update_commitment(
        &self,
        id: NodeId,
        request: UpdateCommitmentRequest,
    ) -> Result<Commitment, WireError>;

    /// Deletes a commitment and everything beneath it — or archives a commitment Habit's iteration,
    async fn delete_commitment(&self, id: NodeId) -> Result<(), WireError>;

    /// Adds a tag to a commitment.
    async fn add_tag_to_commitment(
        &self,
        commitment_id: NodeId,
        tag_id: i64,
    ) -> Result<(), WireError>;

    /// Removes a tag from a commitment.
    async fn remove_tag_from_commitment(
        &self,
        commitment_id: NodeId,
        tag_id: i64,
    ) -> Result<(), WireError>;
}
