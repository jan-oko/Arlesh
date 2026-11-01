//! [`SqliteBackend`]'s `gestures` operations: the in-process core over the local file.

pub use crate::tasks::gestures::StatusStepOutcome;
use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::{
        gestures,
        model::{Commitment, Task},
        rules::gestures::{StatusStep, VerdictPress},
    },
};

use super::SqliteBackend;
use crate::backend::gestures::GesturesPort;

#[async_trait::async_trait]
impl GesturesPort for SqliteBackend {
    async fn step_task_status(
        &self,
        id: NodeId,
        step: StatusStep,
        confirmed: Option<bool>,
    ) -> Result<StatusStepOutcome, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let outcome =
            gestures::step_status(&mut db, &id, step, confirmed == Some(true), now).await?;
        // A refusal wrote nothing, so committing it is committing nothing.
        db.commit().await.map_err(WireError::from_error)?;
        Ok(outcome)
    }

    async fn toggle_task_agentic(&self, id: NodeId) -> Result<Task, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let task = gestures::toggle_agentic(&mut db, &id, now).await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(task)
    }

    async fn press_commitment_verdict(
        &self,
        id: NodeId,
        press: VerdictPress,
    ) -> Result<Commitment, WireError> {
        let now = chrono::Local::now().naive_local();
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let commitment = gestures::press_verdict(&mut db, &id, press, now).await?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(commitment)
    }
}
