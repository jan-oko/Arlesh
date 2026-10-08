//! Re-parenting what is hung on a derived node: a stored node attached to a Habit occurrence is
//! read as that occurrence's child ([`attach_children`]).
//!
//! Pure: it takes the rows a load has read and the occurrences it derived. The reads live in
//! [`crate::nodes::table`], which re-exports these names (ADR 0010).

use std::collections::{HashMap, HashSet};

use crate::{
    flows::{model::HabitInstanceChild, occurrences::DerivedRows},
    infos::model::Info,
    nodes::id::{DerivedId, NodeId},
    nodes::relations::DerivedEdge,
    tasks::model::{Commitment, Expectation, Goal, Task, TaskDependencyEdge},
};

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
    // A wait item's occurrence holds notes, as a wait does.
    for wait in &derived.expectations {
        if let NodeId::Derived(id) = &wait.id {
            present.insert(id.clone(), "expectation");
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
            expectation.id.stored(),
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

/// The dependency edges recorded against derived nodes — an edge added to an occurrence or a check
/// task, or one between a stored Task and a derived one — whose derived ends are in `present`.
///
/// An edge whose derived end is not derived (its template item or cycle pair went, or it lies
/// beyond the horizon) is left out rather than pointing at nothing.
pub fn added_edges_in(
    edges: &[DerivedEdge],
    present: &HashSet<&NodeId>,
) -> Vec<TaskDependencyEdge> {
    let on_board = |id: &NodeId| id.stored().is_some() || present.contains(id);
    edges
        .iter()
        .filter(|edge| edge.added)
        .filter_map(|edge| {
            let (dependent, target) = (edge.dependent()?, edge.target()?);
            let drawn = on_board(&dependent) && on_board(&target);
            drawn.then_some(TaskDependencyEdge {
                task_id: dependent,
                dependency_type: edge.target_type.clone(),
                dependency_id: target,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests;
