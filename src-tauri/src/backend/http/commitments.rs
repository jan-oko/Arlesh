//! [`HttpBackend`]'s `commitments` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::model::{Commitment, CreateCommitmentRequest, UpdateCommitmentRequest},
};

use super::{segment, Call, HttpBackend};
use crate::backend::commitments::CommitmentsPort;
use reqwest::Method;

#[async_trait::async_trait]
impl CommitmentsPort for HttpBackend {
    async fn create_commitment(
        &self,
        request: CreateCommitmentRequest,
    ) -> Result<Commitment, WireError> {
        self.write(Call::new(Method::POST, "/commitments".to_owned()).json(&request))
            .await
    }

    async fn get_commitment(&self, id: i64) -> Result<Commitment, WireError> {
        self.read(Call::new(
            Method::GET,
            format!("/commitments/{}", segment(&id)),
        ))
        .await
    }

    async fn list_commitments(
        &self,
        now: chrono::NaiveDateTime,
    ) -> Result<Vec<Commitment>, WireError> {
        self.read(Call::new(Method::GET, "/commitments".to_owned()).query("now", &now))
            .await
    }

    async fn update_commitment(
        &self,
        id: NodeId,
        request: UpdateCommitmentRequest,
    ) -> Result<Commitment, WireError> {
        self.write(
            Call::new(Method::PATCH, format!("/commitments/{}", segment(&id))).json(&request),
        )
        .await
    }

    async fn delete_commitment(&self, id: NodeId) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/commitments/{}", segment(&id)),
        ))
        .await
    }

    async fn add_tag_to_commitment(
        &self,
        commitment_id: NodeId,
        tag_id: i64,
    ) -> Result<(), WireError> {
        self.write(Call::new(
            Method::PUT,
            format!(
                "/nodes/commitment/{}/tags/{}",
                segment(&commitment_id),
                segment(&tag_id)
            ),
        ))
        .await
    }

    async fn remove_tag_from_commitment(
        &self,
        commitment_id: NodeId,
        tag_id: i64,
    ) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!(
                "/nodes/commitment/{}/tags/{}",
                segment(&commitment_id),
                segment(&tag_id)
            ),
        ))
        .await
    }
}
