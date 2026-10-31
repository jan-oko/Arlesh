//! [`HttpBackend`]'s `expectations` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::model::{
        CreateExpectationRequest, Expectation, SpawnedWait, UpdateExpectationRequest,
        UpdateSpawnedWaitRequest,
    },
};

use super::{segment, Call, HttpBackend};
use crate::backend::expectations::WaitsPort;
use reqwest::Method;

#[async_trait::async_trait]
impl WaitsPort for HttpBackend {
    async fn create_expectation(
        &self,
        request: CreateExpectationRequest,
    ) -> Result<Expectation, WireError> {
        self.write(Call::new(Method::POST, "/waits".to_owned()).json(&request))
            .await
    }

    async fn list_expectations(
        &self,
        now: chrono::NaiveDateTime,
    ) -> Result<Vec<Expectation>, WireError> {
        self.read(Call::new(Method::GET, "/waits".to_owned()).query("now", &now))
            .await
    }

    async fn update_expectation(
        &self,
        id: NodeId,
        request: UpdateExpectationRequest,
    ) -> Result<Expectation, WireError> {
        self.write(Call::new(Method::PATCH, format!("/waits/{}", segment(&id))).json(&request))
            .await
    }

    async fn complete_expectation_check(&self, id: i64) -> Result<Expectation, WireError> {
        self.write(Call::new(
            Method::POST,
            format!("/waits/{}/check/complete", segment(&id)),
        ))
        .await
    }

    async fn update_spawned_wait(
        &self,
        task_id: i64,
        request: UpdateSpawnedWaitRequest,
    ) -> Result<SpawnedWait, WireError> {
        self.write(
            Call::new(
                Method::PATCH,
                format!("/tasks/{}/spawned-wait", segment(&task_id)),
            )
            .json(&request),
        )
        .await
    }

    async fn complete_spawned_wait_check(&self, task_id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::POST,
            format!("/tasks/{}/spawned-wait/check/complete", segment(&task_id)),
        ))
        .await
    }

    async fn add_tag_to_expectation(
        &self,
        expectation_id: crate::nodes::id::NodeId,
        tag_id: i64,
    ) -> Result<(), WireError> {
        self.write(Call::new(
            Method::PUT,
            format!(
                "/nodes/expectation/{}/tags/{}",
                segment(&expectation_id),
                segment(&tag_id)
            ),
        ))
        .await
    }

    async fn remove_tag_from_expectation(
        &self,
        expectation_id: crate::nodes::id::NodeId,
        tag_id: i64,
    ) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!(
                "/nodes/expectation/{}/tags/{}",
                segment(&expectation_id),
                segment(&tag_id)
            ),
        ))
        .await
    }

    async fn delete_expectation(&self, id: NodeId) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/waits/{}", segment(&id)),
        ))
        .await
    }

    async fn reopen_expectation_check(
        &self,
        id: i64,
        due_at: chrono::NaiveDateTime,
    ) -> Result<Expectation, WireError> {
        self.write(
            Call::new(
                Method::POST,
                format!("/waits/{}/check/reopen", segment(&id)),
            )
            .query("due_at", &due_at),
        )
        .await
    }

    async fn reopen_spawned_wait_check(
        &self,
        task_id: i64,
        due_at: chrono::NaiveDateTime,
    ) -> Result<(), WireError> {
        self.write(
            Call::new(
                Method::POST,
                format!("/tasks/{}/spawned-wait/check/reopen", segment(&task_id)),
            )
            .query("due_at", &due_at),
        )
        .await
    }
}
