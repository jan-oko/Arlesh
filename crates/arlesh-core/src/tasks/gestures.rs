//! The gestures the backend decides — the status cycle and `Alt+Enter`, the Agentic key and the
//! verdict controls — as operations over a session.
//!
//! Each takes what the user did, reads the node as it stands, asks [`super::rules::gestures`] what
//! that means, and writes it through the same writer the editor uses. A host renders the outcome —
//! and words it — rather than deciding it.

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::{
    database::session::{Db, Transactional},
    error::WireError,
    nodes::{composite, id::NodeId, write},
    tasks::{
        model::{Commitment, Task, TaskAgentic, UpdateCommitmentRequest, UpdateTaskRequest},
        rules::gestures::{self, BacklogCleared, StatusRefusal, StatusStep, VerdictPress},
    },
};

/// What a status gesture did.
#[derive(Debug, Serialize, schemars::JsonSchema)]
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
#[tracing::instrument(skip(db))]
pub async fn step_status(
    db: &mut Db<Transactional>,
    id: &NodeId,
    step: StatusStep,
    confirmed: bool,
    now: NaiveDateTime,
) -> Result<StatusStepOutcome, WireError> {
    let before = write::task(db, id, now)
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
    let task = composite::update_task_confirmed(db, id, request, confirmed, None, now).await?;
    let backlog_cleared = gestures::backlog_cleared(before.archival, task.archival, next);
    Ok(StatusStepOutcome::Written {
        task: Box::new(task),
        backlog_cleared,
    })
}

/// Flips the Task `id` between Agentic and not, as the Agentic key does.
#[tracing::instrument(skip(db))]
pub async fn toggle_agentic(
    db: &mut Db<Transactional>,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<Task, WireError> {
    let before = write::task(db, id, now)
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
    write::update_task(db, id, request, now)
        .await
        .map_err(WireError::from_error)
}

/// Applies a press of a verdict control to the Commitment `id`.
#[tracing::instrument(skip(db))]
pub async fn press_verdict(
    db: &mut Db<Transactional>,
    id: &NodeId,
    press: VerdictPress,
    now: NaiveDateTime,
) -> Result<Commitment, WireError> {
    let before = write::commitment(db, id, now)
        .await
        .map_err(WireError::from_error)?;
    let request = UpdateCommitmentRequest {
        verdict: Some(gestures::verdict_after(press, before.verdict)),
        ..UpdateCommitmentRequest::default()
    };
    write::update_commitment(db, id, request, now)
        .await
        .map_err(WireError::from_error)
}
