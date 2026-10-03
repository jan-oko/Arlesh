//! Tauri commands for the gestures the backend decides: the status cycle and `Alt+Enter`, the
//! Agentic key and the verdict controls.
//!
//! Each takes what the user did, reads the node as it stands, asks
//! [`crate::tasks::rules::gestures`] what that means, and writes it through the same writer the
//! editor uses. The frontend renders the outcome — and words it — rather than deciding it.

use serde::Serialize;
use tauri::State;

use crate::{
    commands::tasks::write_task_guarded,
    database::session::SessionFactory,
    error::WireError,
    nodes::{id::NodeId, write},
    tasks::{
        model::{Commitment, Task, TaskAgentic, UpdateCommitmentRequest, UpdateTaskRequest},
        rules::gestures::{self, BacklogCleared, StatusRefusal, StatusStep, VerdictPress},
    },
};

/// What a status gesture did.
#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum StatusStepOutcome {
    /// The status was written. `backlog_cleared` says, when it did, that the write took the Task
    /// out of the Backlog — which the frontend says out loud.
    Written {
        /// The Task as the write left it.
        task: Box<Task>,
        /// How the write took it out of the Backlog, if it did.
        backlog_cleared: Option<BacklogCleared>,
    },
    /// Nothing was written, and why.
    Refused {
        /// Why the gesture writes nothing.
        reason: StatusRefusal,
    },
}

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
    let before = write::task(&mut db, &id, now)
        .await
        .map_err(WireError::from_error)?;
    let next = match gestures::status_after(step, before.status, before.compound) {
        Ok(next) => next,
        Err(reason) => return Ok(StatusStepOutcome::Refused { reason }),
    };
    let request = UpdateTaskRequest {
        status: Some(next),
        ..UpdateTaskRequest::default()
    };
    let task = write_task_guarded(&mut db, &id, request, confirmed, now).await?;
    db.commit().await.map_err(WireError::from_error)?;
    let backlog_cleared = gestures::backlog_cleared(before.archival, task.archival, next);
    Ok(StatusStepOutcome::Written {
        task: Box::new(task),
        backlog_cleared,
    })
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
    let before = write::task(&mut db, &id, now)
        .await
        .map_err(WireError::from_error)?;
    let agentic = if gestures::toggled_agentic(before.status.is_agentic()) {
        TaskAgentic::Yes
    } else {
        TaskAgentic::No
    };
    let request = UpdateTaskRequest {
        agentic: Some(agentic),
        ..UpdateTaskRequest::default()
    };
    let task = write::update_task(&mut db, &id, request, now)
        .await
        .map_err(WireError::from_error)?;
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
    let before = write::commitment(&mut db, &id, now)
        .await
        .map_err(WireError::from_error)?;
    let request = UpdateCommitmentRequest {
        verdict: Some(gestures::verdict_after(press, before.verdict)),
        ..UpdateCommitmentRequest::default()
    };
    let commitment = write::update_commitment(&mut db, &id, request, now)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(commitment)
}
