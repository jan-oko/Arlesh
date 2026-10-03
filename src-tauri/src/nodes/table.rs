//! The virtual tables themselves: each kind's stored rows merged with its derived ones.
//!
//! Derivation follows recurrence rules that live in Rust, over an unbounded future, so a virtual
//! table is not a SQL `VIEW` but a Rust-level source every reader goes through: the board load,
//! the filters that run over it, the MCP snapshot and the editors all read [`Board`].
//!
//! Merging is where the two halves meet. A stored node hung on an occurrence (a Task added to
//! tonight's run) keeps its own parent columns pointed at the Habit's host — an occurrence has no
//! integer id for them to hold — and is read here as the occurrence's child, through its
//! attachment, so every reader sees it where it belongs.

use chrono::NaiveDateTime;

use super::{
    id::{DerivedId, NodeId},
    key::{DerivedKey, OccurrenceKey},
    registry,
};
use crate::{
    database::session::{Db, Transactional},
    flows::{
        error::FlowError,
        model::Flow,
        occurrences::{derive_habit, DerivedRows, Horizon},
    },
    tasks::model::TaskDependencyEdge,
};

pub use super::rules::attach::{added_edges_in, attach_children, StoredRows};

/// A Habit whose occurrences could not be derived, named so the load can say so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HabitFailure {
    /// The Habit.
    pub flow_id: i64,
    /// Why, for the user-facing notice.
    pub message: String,
}

/// Every Habit's derived rows within `horizon`, and the Habits that failed to derive.
///
/// One Habit failing does not fail the others: its rows are missing, and it is named in the
/// failures so the frontend can say so rather than draw an empty Habit.
pub async fn derive_habits(
    db: &mut Db<Transactional>,
    flows: &[Flow],
    now: NaiveDateTime,
    horizon: Horizon,
) -> (DerivedRows, Vec<HabitFailure>) {
    let mut rows = DerivedRows::default();
    let mut failures = Vec::new();
    for flow in flows.iter().filter(|flow| flow.is_habit) {
        match derive_habit(db, flow, now, horizon).await {
            Ok(derived) => rows.extend(derived),
            Err(error) => {
                tracing::warn!(flow_id = flow.id, error = %error, "habit derivation failed");
                failures.push(HabitFailure {
                    flow_id: flow.id,
                    message: error.to_string(),
                });
            }
        }
    }
    (rows, failures)
}

/// The dependency edges recorded against derived nodes — an edge added to an occurrence or a check
/// task, or one between a stored Task and a derived one — whose derived ends are in `present`.
/// Reads the edges, and keeps them with [`added_edges_in`].
pub async fn added_edges<M: crate::database::session::SessionMode>(
    db: &mut Db<M>,
    present: &std::collections::HashSet<&NodeId>,
) -> Result<Vec<TaskDependencyEdge>, sqlx::Error> {
    Ok(added_edges_in(
        &db.relations().dependencies().await?,
        present,
    ))
}

/// The value key a derived id stands for.
///
/// Answered from the registry when a row with this id has been served — the ordinary case, since
/// the id reached the caller in a row. Otherwise (a restart between the read and the request, an
/// id carried in a saved tab) every Habit is derived again, which registers every row it serves,
/// and the registry is asked once more. An id no Habit derives is not found.
pub async fn resolve_key(
    db: &mut Db<Transactional>,
    id: &DerivedId,
    now: NaiveDateTime,
) -> Result<DerivedKey, FlowError> {
    if let Some(key) = registry::recall(id) {
        return Ok(key);
    }
    let flows = db.flows().list().await?;
    let (derived, _) = derive_habits(db, &flows, now, Horizon::default()).await;
    if let Some(key) = registry::recall(id) {
        return Ok(key);
    }
    // Not an occurrence: a wait's derived row, which hangs on the Tasks, occurrences included.
    let mut tasks = db.tasks().list().await?;
    tasks.extend(derived.tasks);
    if let Err(error) = super::waits::derive_waits(db, now, &tasks).await {
        tracing::warn!(error = %error, "wait derivation failed while resolving an id");
    }
    registry::recall(id).ok_or_else(|| FlowError::NodeNotFound(id.to_string()))
}

/// [`resolve_key`], for a caller that can only act on an occurrence.
pub async fn resolve_occurrence(
    db: &mut Db<Transactional>,
    id: &DerivedId,
    now: NaiveDateTime,
) -> Result<OccurrenceKey, FlowError> {
    match resolve_key(db, id, now).await? {
        DerivedKey::Occurrence(key) => Ok(key),
        _ => Err(FlowError::Refused(
            "this row is a wait's derived row, not a habit occurrence".to_string(),
        )),
    }
}
