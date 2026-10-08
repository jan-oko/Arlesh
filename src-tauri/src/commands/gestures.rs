//! Tauri commands for the gestures the backend decides: the status cycle and `Alt+Enter`, the
//! Agentic key and the verdict controls.
//!
//! Each takes what the user did, reads the node as it stands, asks
//! [`crate::tasks::rules::gestures`] what that means, and writes it through the same writer the
//! editor uses. The frontend renders the outcome — and words it — rather than deciding it.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    error::WireError,
    nodes::id::NodeId,
    tasks::{
        gestures,
        model::{Commitment, Task},
        rules::gestures::{StatusStep, VerdictPress},
    },
};

pub use crate::tasks::gestures::StatusStepOutcome;

/// Applies a status gesture to the Task `id`: one step of the cycle, or `Alt+Enter`.
///
/// Marking a Habit occurrence done while it holds unfinished children is refused for confirmation,
/// as an edit is, unless `confirmed`.
#[tauri::command]
pub async fn step_task_status(
    factory: State<'_, SessionFactory>,
    id: NodeId,
    step: StatusStep,
    confirmed: Option<bool>,
) -> Result<StatusStepOutcome, WireError> {
    let now = chrono::Local::now().naive_local();
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let outcome = gestures::step_status(&mut db, &id, step, confirmed == Some(true), now).await?;
    // A refusal wrote nothing, so committing it is committing nothing.
    db.commit().await.map_err(WireError::from_error)?;
    Ok(outcome)
}

/// The Agentic key on the Task `id`: writes the opposite of what it reads as, as its own flag.
///
/// A Task's status model follows whether it reads as Agentic, its own flag or inherited, so the
/// model it holds is what it reads as.
#[tauri::command]
pub async fn toggle_task_agentic(
    factory: State<'_, SessionFactory>,
    id: NodeId,
) -> Result<Task, WireError> {
    let now = chrono::Local::now().naive_local();
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let task = gestures::toggle_agentic(&mut db, &id, now).await?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(task)
}

/// A verdict gesture on the Commitment `id`: the cycle, or the Kept or Broken control.
#[tauri::command]
pub async fn press_commitment_verdict(
    factory: State<'_, SessionFactory>,
    id: NodeId,
    press: VerdictPress,
) -> Result<Commitment, WireError> {
    let now = chrono::Local::now().naive_local();
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let commitment = gestures::press_verdict(&mut db, &id, press, now).await?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(commitment)
}
