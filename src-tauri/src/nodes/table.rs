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

use std::collections::HashMap;

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
        model::{Flow, HabitInstanceChild},
        occurrences::{derive_habit, DerivedRows, Horizon},
    },
    infos::model::Info,
    tasks::model::{Commitment, Expectation, Goal, Task, TaskDependencyEdge},
};

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

/// The stored rows a load reads, which [`attach_children`] re-parents in place.
pub struct StoredRows<'rows> {
    /// Stored Tasks.
    pub tasks: &'rows mut [Task],
    /// Stored Goals.
    pub goals: &'rows mut [Goal],
    /// Stored Commitments.
    pub commitments: &'rows mut [Commitment],
    /// Stored Expectations.
    pub expectations: &'rows mut [Expectation],
    /// Stored Infos.
    pub infos: &'rows mut [Info],
}

/// Reads every stored node hung on a derived one as that node's child.
///
/// A child whose occurrence is not among `derived` — its cycle pair was removed, or its Habit
/// failed to derive — keeps its stored parent, the Habit's host, and so stays on the board beside
/// where it was rather than vanishing with the occurrence.
pub fn attach_children(
    children: &[HabitInstanceChild],
    derived: &DerivedRows,
    rows: StoredRows<'_>,
) {
    let mut present: HashMap<DerivedId, &'static str> = HashMap::new();
    for task in &derived.tasks {
        if let NodeId::Derived(id) = &task.id {
            present.insert(id.clone(), "task");
        }
    }
    for goal in &derived.goals {
        if let NodeId::Derived(id) = &goal.id {
            present.insert(id.clone(), "goal");
        }
    }
    for commitment in &derived.commitments {
        if let NodeId::Derived(id) = &commitment.id {
            present.insert(id.clone(), "commitment");
        }
    }
    let parents: HashMap<(String, i64), (&'static str, DerivedId)> = children
        .iter()
        .filter_map(|child| {
            let id = DerivedId::of_key(&child.parent_key);
            let kind = present.get(&id)?;
            Some(((child.child_type.clone(), child.child_id), (*kind, id)))
        })
        .collect();
    let reparent =
        |kind: &str, id: Option<i64>, parent_type: &mut String, parent_id: &mut NodeId| {
            if let Some((parent_kind, parent)) =
                id.and_then(|id| parents.get(&(kind.to_string(), id)))
            {
                *parent_type = (*parent_kind).to_string();
                *parent_id = NodeId::Derived(parent.clone());
            }
        };
    for task in rows.tasks.iter_mut() {
        reparent(
            "task",
            task.id.stored(),
            &mut task.parent_type,
            &mut task.parent_id,
        );
    }
    for goal in rows.goals.iter_mut() {
        reparent(
            "goal",
            goal.id.stored(),
            &mut goal.parent_type,
            &mut goal.parent_id,
        );
    }
    for commitment in rows.commitments.iter_mut() {
        reparent(
            "commitment",
            commitment.id.stored(),
            &mut commitment.parent_type,
            &mut commitment.parent_id,
        );
    }
    for expectation in rows.expectations.iter_mut() {
        reparent(
            "expectation",
            Some(expectation.id),
            &mut expectation.parent_type,
            &mut expectation.parent_id,
        );
    }
    for info in rows.infos.iter_mut() {
        reparent(
            "info",
            Some(info.id),
            &mut info.parent_type,
            &mut info.parent_id,
        );
    }
}

/// The dependency edges recorded against derived nodes — an edge added to an occurrence, or one
/// between a stored Task and an occurrence — whose derived ends are on the board.
///
/// An edge whose derived end is not derived (its template item or cycle pair went, or it lies
/// beyond the horizon) is left out rather than pointing at nothing.
pub async fn added_edges<M: crate::database::session::SessionMode>(
    db: &mut Db<M>,
    derived: &DerivedRows,
) -> Result<Vec<TaskDependencyEdge>, sqlx::Error> {
    let present: std::collections::HashSet<&NodeId> = derived
        .tasks
        .iter()
        .map(|task| &task.id)
        .chain(derived.goals.iter().map(|goal| &goal.id))
        .collect();
    let on_board = |id: &NodeId| id.stored().is_some() || present.contains(id);
    Ok(db
        .relations()
        .dependencies()
        .await?
        .into_iter()
        .filter(|edge| edge.added)
        .filter_map(|edge| {
            let (dependent, target) = (edge.dependent()?, edge.target()?);
            (on_board(&dependent) && on_board(&target)).then(|| TaskDependencyEdge {
                task_id: dependent,
                dependency_type: edge.target_type,
                dependency_id: target,
            })
        })
        .collect())
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
    derive_habits(db, &flows, now, Horizon::default()).await;
    registry::recall(id).ok_or_else(|| FlowError::NodeNotFound(id.to_string()))
}

/// [`resolve_key`], for a caller that can only act on an occurrence.
pub async fn resolve_occurrence(
    db: &mut Db<Transactional>,
    id: &DerivedId,
    now: NaiveDateTime,
) -> Result<OccurrenceKey, FlowError> {
    let DerivedKey::Occurrence(key) = resolve_key(db, id, now).await?;
    Ok(key)
}

#[cfg(test)]
mod tests;
