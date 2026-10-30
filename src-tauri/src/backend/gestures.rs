//! The `gestures` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::gestures`] ask of whichever backend the app runs on.

pub use crate::tasks::gestures::StatusStepOutcome;
use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::{
        model::{Commitment, Task},
        rules::gestures::{StatusStep, VerdictPress},
    },
};

/// The `gestures` operations a backend serves.
#[async_trait::async_trait]
pub trait GesturesPort: Send + Sync {
    /// Applies a status gesture to the Task `id`: one step of the cycle, or `Alt+Enter`.
    async fn step_task_status(
        &self,
        id: NodeId,
        step: StatusStep,
        confirmed: Option<bool>,
    ) -> Result<StatusStepOutcome, WireError>;

    /// The Agentic key on the Task `id`: writes the opposite of what it reads as, as its own flag.
    async fn toggle_task_agentic(&self, id: NodeId) -> Result<Task, WireError>;

    /// A verdict gesture on the Commitment `id`: the cycle, or the Kept or Broken control.
    async fn press_commitment_verdict(
        &self,
        id: NodeId,
        press: VerdictPress,
    ) -> Result<Commitment, WireError>;
}
