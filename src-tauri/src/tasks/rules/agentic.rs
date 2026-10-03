//! The Agentic rules a write is held to: which status a Task holds once its kind is known
//! ([`settle_status`]), how a Task left without a counterpart status is named ([`stranded`]), and
//! that an Agentic Task cannot start without a Spec ([`require_spec`]).
//!
//! Pure. Reading whether a Task *reads as* Agentic climbs the tree, and lives in
//! [`crate::tasks::agentic`], which re-exports these names (ADR 0010).

use crate::tasks::error::TaskError;
use crate::tasks::model::{AgenticBrief, AgenticStatus, Status};

/// The status a Task holds after a write, in the model its kind holds then.
///
/// `before` is what the row held, `requested` what the write names, `agentic` the kind after the
/// write. A value already in that model stands — except Review, which is derived and never set. A
/// requested value of the other model is refused when the kind does not change: an ordinary
/// Started on an Agentic Task, say, or On Agent on an ordinary one. When the kind **does** change —
/// a flag change, or a move under another ancestor — the value is **converted** explicitly
/// ([`Status::converted`]), and refused, naming the Task, when it has no counterpart there.
pub(crate) fn settle_status(
    title: &str,
    before: Status,
    requested: Option<Status>,
    agentic: bool,
) -> Result<Status, TaskError> {
    if requested == Some(Status::Agentic(AgenticStatus::Review)) {
        return Err(TaskError::ReviewIsDerived);
    }
    let value = requested.unwrap_or(before);
    if value.is_agentic() == agentic {
        return Ok(value);
    }
    let kind_changes = before.is_agentic() != agentic;
    if requested.is_some() && !kind_changes {
        return Err(match agentic {
            true => TaskError::NotAgenticStatus(value.as_str().to_string()),
            false => TaskError::NotOrdinaryStatus(value.as_str().to_string()),
        });
    }
    value
        .converted(agentic)
        .ok_or_else(|| TaskError::KindConversion(stranded(title, value)))
}

/// How a Task left without a counterpart is named in a refusal.
pub(crate) fn stranded(title: &str, status: Status) -> String {
    format!("“{title}” ({})", status.as_str().replace('_', " "))
}

/// Refuses to start something that reads as Agentic, `agentic` already resolved, while `brief` has
/// no Spec.
pub(crate) fn require_spec(agentic: bool, brief: &Option<AgenticBrief>) -> Result<(), TaskError> {
    if agentic && !brief.as_ref().is_some_and(AgenticBrief::has_spec) {
        return Err(TaskError::AgenticSpecMissing);
    }
    Ok(())
}
