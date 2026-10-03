//! **Compound**, where it touches the database: drawing a board's waits and settling its compound
//! Tasks ([`settle`]), and keeping a derived status when compound is switched off
//! ([`keep_derived_status`]).
//!
//! The rule itself — what a compound Task reads as, and when one is blocked — is pure and lives in
//! [`crate::tasks::rules::compound`]. Its public names are re-exported here, so callers did not
//! change when it moved (ADR 0010).

use std::collections::HashMap;

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, SessionMode, Transactional},
    error::AppError,
    nodes::{id::NodeId, waits::derive_waits},
};

use super::{
    lifecycle::{effective_due, Archival},
    model::{Task, TaskArchival, TaskId, TimeScope, UpdateTaskRequest},
    rules::compound::delegated_done,
    scope_rules::{scope_governance_with, OccurrenceExit},
};

pub use super::rules::compound::{
    apply, blocked, commitment_reading, derive, expectation_reading, goal_reading, progress,
    task_reading, Board, Governance, Outcome, Rows, Settled,
};

pub mod instants;

/// The most rounds [`settle`] takes. Each round settles at least one more level of compound
/// Tasks nested inside each other, so only a board nested deeper than this could reach it.
const MAX_ROUNDS: usize = 16;

/// Draws the board's waits and derives every compound Task's status, until the two agree.
///
/// A board with no compound Task costs exactly the one [`derive_waits`] it always did.
#[tracing::instrument(skip(db, board))]
pub async fn settle<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
    board: Board<'_>,
) -> Result<Settled, AppError> {
    let Board {
        tasks,
        goals,
        commitments,
        expectations,
        lifecycles,
        settled,
        instants,
        exit,
    } = board;
    let mut waits = derive_waits(db, now, &*tasks).await?;
    if !tasks.iter().any(|task| task.compound) {
        return Ok(Settled {
            waits,
            outcomes: Vec::new(),
        });
    }
    let governance = governance_of(db, &*tasks, exit).await?;
    let mut drawn_for = delegated_done(&*tasks);
    let mut outcomes = Vec::new();
    for _ in 0..MAX_ROUNDS {
        outcomes = derive(
            &Rows {
                tasks: &*tasks,
                checks: &waits.tasks,
                goals,
                commitments,
                expectations,
                waits: &waits.expectations,
                lifecycles: &*lifecycles,
                wait_lifecycles: &waits.lifecycles,
                settled,
                instants,
            },
            &governance,
            now,
        );
        apply(&outcomes, &mut *tasks, &mut *lifecycles);
        let delegated = delegated_done(&*tasks);
        if delegated == drawn_for {
            return Ok(Settled { waits, outcomes });
        }
        drawn_for = delegated;
        waits = derive_waits(db, now, &*tasks).await?;
    }
    tracing::warn!(
        rounds = MAX_ROUNDS,
        "compound tasks did not settle; serving the last round"
    );
    Ok(Settled { waits, outcomes })
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

/// Each compound stored Task's [`Governance`].
async fn governance_of<M: SessionMode>(
    db: &mut Db<M>,
    tasks: &[Task],
    exit: OccurrenceExit,
) -> Result<HashMap<NodeId, Governance>, AppError> {
    let mut out = HashMap::new();
    for task in tasks.iter().filter(|task| task.compound) {
        let Some(row) = task.id.stored() else {
            continue;
        };
        let governed = scope_governance_with(db, "task", row, exit).await?;
        let (window, on_exit) = governed.unzip();
        let due = effective_due(
            task.due_scope.as_ref().map(TimeScope::window),
            governed,
            task.archival == TaskArchival::Backlog,
        );
        out.insert(
            task.id.clone(),
            Governance {
                window,
                on_exit,
                due,
                stored: Archival::from(task.archival),
            },
        );
    }
    Ok(out)
}
