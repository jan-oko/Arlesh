//! The write guard for Plan inheritance: a write that breaks a plan rule is refused, naming the
//! nodes (`docs/spec/time-scopes.md`, *Plan inheritance*).
//!
//! A write can break a rule below the row it touches — moving a Task's Plan away from a child's
//! window leaves the child with nothing, and narrowing a Habit's target leaves the Habit outside —
//! so after the write, inside its transaction, the guard reads the board's plan rules once and
//! refuses any rule broken within the write's **reach**: the nodes it wrote and everything beneath
//! them, and the Habits hung there. Nothing else's effective Plan can have changed. The board holds
//! no violation before a write, so any it finds there is the write's own; the refusal rolls the
//! whole write back.

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    flows::occurrences::Horizon,
    tasks::error::TaskError,
};

use super::rules::plans::{refusal_message, PlanAudit};

/// The board's plan audit at `now`, read inside the write's transaction.
pub async fn audit(db: &mut Db<Transactional>, now: NaiveDateTime) -> Result<PlanAudit, AppError> {
    Ok(super::load_within(db, now, Horizon::default(), false)
        .await?
        .plans)
}

/// Refuses the write just made when it left a plan rule broken within its reach — the nodes in
/// `written` (keyed as the board keys a node) and everything beneath them.
pub async fn check(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
    written: &[String],
) -> Result<(), AppError> {
    let after = audit(db, now).await?;
    refuse(&after, written)
}

/// Refuses when `after` breaks a plan rule within the reach of `written`.
pub fn refuse(after: &PlanAudit, written: &[String]) -> Result<(), AppError> {
    let reach = after.reach(written);
    let refused: Vec<_> = after
        .conflicts
        .iter()
        .filter(|entry| reach.contains(&entry.key))
        .collect();
    if refused.is_empty() {
        return Ok(());
    }
    tracing::warn!(
        count = refused.len(),
        "write refused for breaking a plan rule"
    );
    Err(TaskError::ScopeContainment(refusal_message(&refused)).into())
}
