//! The dependency rules: how a "Blocked by …" reason names what it is blocked by
//! ([`dependency_name`]), which Tasks can be given a prerequisite ([`holds_dependencies`]), and
//! what a Task may be made to depend on ([`candidates`]).
//!
//! Pure. Which dependencies are unmet is read in [`crate::tasks`] (ADR 0010).

use std::collections::{HashMap, HashSet};

use crate::{
    nodes::{id::NodeId, origin::Origin},
    tasks::model::{Dependency, Expectation, Goal, Task, TaskDependencyEdge},
};

/// How a "Blocked by …" reason names the node it is blocked by: its **short id** from `names` —
/// keyed as the board keys a node, `task-12` — or, for a node `names` does not hold, its id.
pub fn dependency_name(names: &HashMap<String, String>, kind: &str, id: &NodeId) -> String {
    names
        .get(&format!("{kind}-{id}"))
        .cloned()
        .unwrap_or_else(|| id.to_string())
}

/// Whether a Task with this `origin` can be given a prerequisite: a stored Task or a Habit
/// occurrence. A wait's check task draws no row an edge can hang on.
pub fn holds_dependencies(origin: &Origin) -> bool {
    matches!(origin, Origin::Manual | Origin::Habit(_))
}

/// One node on the board, as a dependency edge names it.
fn edge_key(kind: &str, id: &NodeId) -> String {
    format!("{kind}-{id}")
}

/// Every Task that already depends on `dependent`, directly or through a chain, and `dependent`
/// itself — a pick among them would close a cycle.
fn transitive_dependents(dependent: &NodeId, edges: &[TaskDependencyEdge]) -> HashSet<String> {
    let mut reached = HashSet::from([edge_key("task", dependent)]);
    let mut stack = vec![dependent.clone()];
    while let Some(current) = stack.pop() {
        for edge in edges {
            if edge.dependency_type != "task" || edge.dependency_id != current {
                continue;
            }
            if reached.insert(edge_key("task", &edge.task_id)) {
                stack.push(edge.task_id.clone());
            }
        }
    }
    reached
}

/// What the Task `dependent` may be made to depend on, in board order: every Task that holds
/// dependencies itself (a stored Task or a Habit occurrence), every Goal, and every stored
/// Expectation — less what it already depends on, and less every Task that already depends on it,
/// directly or through a chain, which would close a cycle the writer refuses. A Goal or an
/// Expectation depends on nothing, so no cycle runs through one; a derived wait has no stored row an
/// Expectation edge can name.
pub fn candidates(
    dependent: &NodeId,
    tasks: &[Task],
    goals: &[Goal],
    expectations: &[Expectation],
    edges: &[TaskDependencyEdge],
) -> Vec<Dependency> {
    let mut excluded = transitive_dependents(dependent, edges);
    excluded.extend(
        edges
            .iter()
            .filter(|edge| &edge.task_id == dependent)
            .map(|edge| edge_key(&edge.dependency_type, &edge.dependency_id)),
    );
    let tasks = tasks
        .iter()
        .filter(|task| holds_dependencies(&task.origin))
        .map(|task| Dependency::Task {
            id: task.id.clone(),
        });
    let goals = goals.iter().map(|goal| Dependency::Goal {
        id: goal.id.clone(),
    });
    let waits = expectations
        .iter()
        .filter_map(|wait| wait.id.stored())
        .map(|id| Dependency::Expectation { id });
    tasks
        .chain(goals)
        .chain(waits)
        .filter(|dependency| !excluded.contains(&key_of(dependency)))
        .collect()
}

/// The edge key a dependency names.
fn key_of(dependency: &Dependency) -> String {
    match dependency {
        Dependency::Task { id } => edge_key("task", id),
        Dependency::Goal { id } => edge_key("goal", id),
        Dependency::Expectation { id } => edge_key("expectation", &NodeId::Stored(*id)),
    }
}

#[cfg(test)]
mod tests;
