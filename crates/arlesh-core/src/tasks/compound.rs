//! **Compound**, where it touches the database: drawing a board's waits and settling its compound
//! Tasks ([`settle`]), and keeping a derived status when compound is switched off
//! ([`keep_derived_status`]).
//!
//! The rule itself — what a compound Task reads as, and when one is blocked — is pure and lives in
//! [`crate::tasks::rules::compound`]. Its public names are re-exported here, so callers did not
//! change when it moved (ADR 0010).

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, SessionMode, Transactional},
    error::AppError,
    mindmap::model::MindmapLoad,
    nodes::{id::NodeId, waits::WaitData},
};

use super::{
    error::TaskError,
    model::{TaskId, UpdateTaskRequest},
    rules::{ancestry::AncestryIndex, compound::settle_in, gestures::SubItems},
    scope_rules,
};

pub use super::rules::compound::{
    apply, blocked, commitment_reading, derive, expectation_reading, goal_reading, parent_reading,
    progress, subtree_of, task_reading, Board, Governance, Outcome, Rows, Settled,
};

pub mod instants;

/// Draws the board's waits and derives every compound Task's status, until the two agree.
///
/// A board with no compound Task costs exactly the one wait derivation it always did; one with
/// some also reads the ancestry index each compound Task's governance is climbed over.
#[tracing::instrument(skip(db, board))]
pub async fn settle<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
    board: Board<'_>,
) -> Result<Settled, AppError> {
    let waits = WaitData::read(db).await?;
    let ancestry = if board.tasks.iter().any(|task| task.compound) {
        scope_rules::ancestry_index(db).await?
    } else {
        AncestryIndex::default()
    };
    settle_in(&waits.sources(), &ancestry, now, board)
}

/// Names the status a compound Task — stored, or a Habit occurrence — is showing, when `request`
/// switches its compound off without naming one — so switching it off **keeps** that status, in
/// the same write, and one undo takes both back. A request that names a status is taken at its
/// word, and any other request is left alone.
#[tracing::instrument(skip(db, request))]
pub async fn keep_derived_status(
    db: &mut Db<Transactional>,
    id: &NodeId,
    request: &mut UpdateTaskRequest,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    if request.compound != Some(false) || request.status.is_some() {
        return Ok(());
    }
    // A stored row says for itself whether it is compound, without deriving the board.
    if let Some(row) = id.stored() {
        if !db.tasks().get(TaskId(row)).await?.compound {
            return Ok(());
        }
    }
    request.status = crate::mindmap::load(db, now)
        .await?
        .tasks
        .iter()
        .find(|task| task.id == *id && task.compound)
        .map(|task| task.status.stored());
    Ok(())
}

/// The [`SubItems`] of the Task `id` on a loaded board.
fn read_sub_items(load: &MindmapLoad, id: &NodeId) -> SubItems {
    subtree_of(
        &Rows {
            tasks: &load.tasks,
            checks: &[],
            goals: &load.goals,
            commitments: &load.commitments,
            expectations: &load.expectations,
            waits: &[],
            lifecycles: &load.lifecycles,
            wait_lifecycles: &[],
            settled: &std::collections::HashSet::new(),
            instants: &std::collections::HashMap::new(),
        },
        id,
    )
}

/// What the sub-items of the Task `id` say about it, read off the board as a load serves it: the
/// floor they make it read at, and how many counted items are not Done. `None` when the board does
/// not hold the Task.
#[tracing::instrument(skip(db))]
pub async fn sub_items(
    db: &mut Db<Transactional>,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<Option<SubItems>, AppError> {
    let load = crate::mindmap::load(db, now).await?;
    let held = load.tasks.iter().any(|task| task.id == *id);
    Ok(held.then(|| read_sub_items(&load, id)))
}

/// Refuses setting the Task `id` Done while a counted sub-item is not ([`TaskError::OpenSubItems`]).
/// A Task that already reads Done is left as it is: nothing changes retroactively, so a parent
/// already Done with an open child stays Done, and writing Done again to it is no change.
#[tracing::instrument(skip(db))]
pub async fn require_closed(
    db: &mut Db<Transactional>,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let load = crate::mindmap::load(db, now).await?;
    let Some(task) = load.tasks.iter().find(|task| task.id == *id) else {
        return Ok(());
    };
    if task.status.is_done() {
        return Ok(());
    }
    match read_sub_items(&load, id).open {
        0 => Ok(()),
        open => Err(TaskError::OpenSubItems { open }.into()),
    }
}
