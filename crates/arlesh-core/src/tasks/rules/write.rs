//! The write rules a Task update is held to beyond containment: a Task is never both backlogged
//! and planned ([`reject_backlog_with_plan`]), and switching compound off may name the status it
//! keeps ([`releases_compound`]).
//!
//! Pure. The writes that call them live in [`crate::tasks`] (ADR 0010).

use crate::tasks::error::TaskError;
use crate::tasks::model::{Task, TaskArchival, TimeScope, UpdateTaskRequest};

/// Refuses a write that would leave a Task both backlogged and planned.
///
/// The invariant is `archival = Backlog ⇒ plan IS NULL`, and this is the single place it is
/// enforced, for creates and updates alike. It is deliberately not a schema CHECK: the frontend
/// answers this refusal by asking again with the Plan cleared, which reads as a prompt rather than
/// as corrupt input.
pub(in crate::tasks) fn reject_backlog_with_plan(
    archival: TaskArchival,
    plan: &Option<TimeScope>,
) -> Result<(), TaskError> {
    if plan.is_some() && !archival.allows_plan() {
        return Err(TaskError::BacklogWithPlan);
    }
    Ok(())
}

/// Whether `request` switches a compound `stored` Task's compound off — the one write that may
/// name its status, since what it names is the derived status being kept.
pub(in crate::tasks) fn releases_compound(stored: &Task, request: &UpdateTaskRequest) -> bool {
    stored.compound && request.compound == Some(false)
}
