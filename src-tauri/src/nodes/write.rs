//! Writes through the virtual tables: one request, routed by the id it names.
//!
//! A request naming a stored row goes where it always went. A request naming a derived row — a
//! Habit occurrence — is resolved to the occurrence's value key and applied to its overlay
//! ([`crate::flows::occurrence_edit`]), and the row comes back as the virtual table now serves it.
//! Neither the caller nor the request knows the difference: that is the whole of ADR 0008's
//! "the normal editor sends a normal update request for either".

use chrono::NaiveDateTime;

use super::{id::NodeId, table::resolve_occurrence};
use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    flows::{error::FlowError, model::UnfinishedChild, occurrence_edit},
    tasks::model::{
        Commitment, CommitmentId, Goal, GoalId, Task, TaskId, UpdateCommitmentRequest,
        UpdateGoalRequest, UpdateTaskRequest,
    },
};

/// The occurrence `key` names was derived, but not as the kind the caller asked for.
fn wrong_kind(id: &NodeId, kind: &str) -> AppError {
    FlowError::Refused(format!("node {id} is not a {kind}")).into()
}

/// Updates a Task, stored or derived.
#[tracing::instrument(skip(db, request))]
pub async fn update_task(
    db: &mut Db<Transactional>,
    id: &NodeId,
    request: UpdateTaskRequest,
    now: NaiveDateTime,
) -> Result<Task, AppError> {
    let derived = match id {
        NodeId::Stored(id) => return Ok(crate::tasks::update_task(db, TaskId(*id), request).await?),
        NodeId::Derived(derived) => derived,
    };
    let key = resolve_occurrence(db, derived, now).await?;
    occurrence_edit::update_task(db, &key, request, now).await?;
    match occurrence_edit::occurrence_row(db, &key, now).await? {
        (Some(task), _, _) => Ok(task),
        _ => Err(wrong_kind(id, "task")),
    }
}

/// Updates a Goal, stored or derived.
#[tracing::instrument(skip(db, request))]
pub async fn update_goal(
    db: &mut Db<Transactional>,
    id: &NodeId,
    request: UpdateGoalRequest,
    now: NaiveDateTime,
) -> Result<Goal, AppError> {
    let derived = match id {
        NodeId::Stored(id) => return Ok(crate::tasks::update_goal(db, GoalId(*id), request).await?),
        NodeId::Derived(derived) => derived,
    };
    let key = resolve_occurrence(db, derived, now).await?;
    occurrence_edit::update_goal(db, &key, request, now).await?;
    match occurrence_edit::occurrence_row(db, &key, now).await? {
        (_, Some(goal), _) => Ok(goal),
        _ => Err(wrong_kind(id, "goal")),
    }
}

/// Updates a Commitment, stored or derived — including recording its Verdict.
#[tracing::instrument(skip(db, request))]
pub async fn update_commitment(
    db: &mut Db<Transactional>,
    id: &NodeId,
    request: UpdateCommitmentRequest,
    now: NaiveDateTime,
) -> Result<Commitment, AppError> {
    let derived = match id {
        NodeId::Stored(id) => {
            return Ok(crate::tasks::update_commitment(db, CommitmentId(*id), request).await?)
        }
        NodeId::Derived(derived) => derived,
    };
    let key = resolve_occurrence(db, derived, now).await?;
    occurrence_edit::update_commitment(db, &key, request, now).await?;
    match occurrence_edit::occurrence_row(db, &key, now).await? {
        (_, _, Some(commitment)) => Ok(commitment),
        _ => Err(wrong_kind(id, "commitment")),
    }
}

/// The nodes hung on an occurrence that are not finished — what completing it would close over.
///
/// A stored node has none to report: the guard belongs to a Habit occurrence, whose added
/// children archive with it when its window passes (see `docs/spec/habits.md`).
pub async fn unfinished_children(
    db: &mut Db<Transactional>,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<Vec<UnfinishedChild>, AppError> {
    let NodeId::Derived(derived) = id else {
        return Ok(Vec::new());
    };
    let key = resolve_occurrence(db, derived, now).await?;
    Ok(crate::flows::unfinished_instance_children(db, &key).await?)
}

/// Deletes a node of any of the three kinds — or, for a derived one, **archives** it: an
/// occurrence is never deleted (ADR 0008, decision 7).
#[tracing::instrument(skip(db))]
pub async fn delete(
    db: &mut Db<Transactional>,
    kind: &str,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let derived = match (kind, id) {
        ("goal", NodeId::Stored(id)) => {
            return Ok(crate::tasks::delete_goal(db, GoalId(*id)).await?)
        }
        ("commitment", NodeId::Stored(id)) => {
            return Ok(crate::tasks::delete_commitment(db, CommitmentId(*id)).await?)
        }
        (_, NodeId::Stored(id)) => return Ok(crate::tasks::delete_task(db, TaskId(*id)).await?),
        (_, NodeId::Derived(derived)) => derived,
    };
    let key = resolve_occurrence(db, derived, now).await?;
    occurrence_edit::archive(db, &key).await?;
    Ok(())
}
