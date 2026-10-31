//! Tauri commands for the gestures the backend decides: the status cycle and `Alt+Enter`, the
//! Agentic key and the verdict controls.
//!
//! Each takes what the user did, reads the node as it stands, asks
//! [`crate::tasks::rules::gestures`] what that means, and writes it through the same writer the
//! editor uses. The frontend renders the outcome — and words it — rather than deciding it.

use tauri::State;

use crate::backend::AppBackend;
pub use crate::tasks::gestures::StatusStepOutcome;
use crate::{
    error::WireError,
    nodes::id::NodeId,
    tasks::{
        model::{Commitment, Task},
        rules::gestures::{StatusStep, VerdictPress},
    },
};

/// Applies a status gesture to the Task `id`: one step of the cycle, or `Alt+Enter`.
///
/// Marking a Habit occurrence done while it holds unfinished children is refused for confirmation,
/// as an edit is, unless `confirmed`.
#[tauri::command]
pub async fn step_task_status(
    backend: State<'_, AppBackend>,
    id: NodeId,
    step: StatusStep,
    confirmed: Option<bool>,
) -> Result<StatusStepOutcome, WireError> {
    backend.step_task_status(id, step, confirmed).await
}

/// The Agentic key on the Task `id`: writes the opposite of what it reads as, as its own flag.
///
/// A Task's status model follows whether it reads as Agentic, its own flag or inherited, so the
/// model it holds is what it reads as.
#[tauri::command]
pub async fn toggle_task_agentic(
    backend: State<'_, AppBackend>,
    id: NodeId,
) -> Result<Task, WireError> {
    backend.toggle_task_agentic(id).await
}

/// A verdict gesture on the Commitment `id`: the cycle, or the Kept or Broken control.
#[tauri::command]
pub async fn press_commitment_verdict(
    backend: State<'_, AppBackend>,
    id: NodeId,
    press: VerdictPress,
) -> Result<Commitment, WireError> {
    backend.press_commitment_verdict(id, press).await
}
