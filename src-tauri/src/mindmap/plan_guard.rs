//! The write guard for Plan inheritance: a write that breaks a plan rule is refused, naming the
//! nodes (`docs/spec/time-scopes.md`, *Plan inheritance*).
//!
//! A write can break a rule far from the row it touches — moving a Task's Plan away from a child's
//! window leaves the child with nothing, and narrowing a Habit's target leaves the Habit outside —
//! so the guard reads the whole board before the write and again after it, inside the write's
//! transaction, and refuses what the write added. An existing violation is not the write's doing
//! and stays flagged until its own node is next edited; that edit must resolve it.

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

/// What the board broke before a write.
pub struct PlanGuard {
    before: PlanAudit,
}

impl PlanGuard {
    /// Reads the board before the write.
    pub async fn before(db: &mut Db<Transactional>, now: NaiveDateTime) -> Result<Self, AppError> {
        Ok(Self {
            before: audit(db, now).await?,
        })
    }

    /// The board as it stood before the write.
    pub fn board(&self) -> &PlanAudit {
        &self.before
    }

    /// Refuses the write when the board now breaks a rule it did not, or one on a node the write
    /// touched (`written`, keyed as the board keys a node).
    pub async fn check(
        self,
        db: &mut Db<Transactional>,
        now: NaiveDateTime,
        written: &[String],
    ) -> Result<(), AppError> {
        let after = audit(db, now).await?;
        refuse(&self.before, &after, written)
    }
}

/// Refuses a write that left `after` breaking what `before` did not, or breaking anything on a
/// node in `written`.
pub fn refuse(before: &PlanAudit, after: &PlanAudit, written: &[String]) -> Result<(), AppError> {
    let broken = before.broken();
    let written = written.iter().cloned().collect();
    let pairs: Vec<(String, _)> = after
        .conflicts
        .iter()
        .map(|entry| (entry.key.clone(), entry.conflict))
        .collect();
    let refused: Vec<_> =
        crate::tasks::rules::plan_inheritance::refusable(&broken, &pairs, &written)
            .into_iter()
            .filter_map(|(key, conflict)| {
                after
                    .conflicts
                    .iter()
                    .find(|entry| &entry.key == key && entry.conflict == *conflict)
            })
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
