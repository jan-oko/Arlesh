//! **Review**: an On Agent Task whose agent has a question open for the user — derived on every
//! board load, never stored (see `docs/spec/resources.md`, "Agentic statuses").
//!
//! An agent leaves its responsibility only by raising a question (`arlesh_waits.ask`): while one
//! is pending beneath the Task it reads Review, and once the question is released — answered — it
//! reads On Agent again. A wait that is not a question (CI, say) changes nothing, nor does a
//! question under a Task the user is on (Doing): Review is the agent's hand-back, not the user's.

use std::collections::HashSet;

use crate::nodes::id::NodeId;

use crate::tasks::model::{
    AgenticStatus, Expectation, ExpectationArchival, ExpectationStatus, Status, Task,
};

/// Whether `wait` is an open agentic question — pending, live, raised by an agent as a question —
/// hanging directly under a Task.
pub fn is_open_question(wait: &Expectation) -> bool {
    wait.parent_type == "task"
        && wait.agentic
        && wait.question
        && wait.status == ExpectationStatus::Pending
        && wait.archival == ExpectationArchival::Live
}

/// Turns every On Agent Task in `tasks` with an open question beneath it, among `waits`, into
/// Review.
pub fn derive(tasks: &mut [Task], waits: &[Expectation]) {
    let asking: HashSet<&NodeId> = waits
        .iter()
        .filter(|wait| is_open_question(wait))
        .map(|wait| &wait.parent_id)
        .collect();
    for task in tasks.iter_mut() {
        if task.status == Status::Agentic(AgenticStatus::OnAgent) && asking.contains(&task.id) {
            task.status = Status::Agentic(AgenticStatus::Review);
        }
    }
}

#[cfg(test)]
mod tests;
