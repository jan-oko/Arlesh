//! [`HttpBackend`]'s `gestures` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::{
        model::{Commitment, Task},
        rules::gestures::{StatusStep, VerdictPress},
    },
};

use super::{segment, Call, HttpBackend};
use crate::backend::gestures::GesturesPort;
use crate::tasks::gestures::StatusStepOutcome;
use reqwest::Method;

#[async_trait::async_trait]
impl GesturesPort for HttpBackend {
    async fn step_task_status(
        &self,
        id: NodeId,
        step: StatusStep,
        confirmed: Option<bool>,
    ) -> Result<StatusStepOutcome, WireError> {
        self.write(
            Call::new(Method::POST, format!("/tasks/{}/status", segment(&id)))
                .query("step", &step)
                .query_opt("confirmed", confirmed.as_ref()),
        )
        .await
    }

    async fn toggle_task_agentic(&self, id: NodeId) -> Result<Task, WireError> {
        self.write(Call::new(
            Method::POST,
            format!("/tasks/{}/agentic/toggle", segment(&id)),
        ))
        .await
    }

    async fn press_commitment_verdict(
        &self,
        id: NodeId,
        press: VerdictPress,
    ) -> Result<Commitment, WireError> {
        self.write(
            Call::new(
                Method::POST,
                format!("/commitments/{}/verdict", segment(&id)),
            )
            .query("press", &press),
        )
        .await
    }
}
