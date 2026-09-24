//! Agentic as an object: the brief a Task carries for an agent, and the rules the flag enforces.
//!
//! The **flag** (`tasks.agentic`) is unchanged: three-state and inherited, a Task with no value of
//! its own reading its nearest flagged ancestor. The **brief** is the Task's own and never
//! inherited — priority, Spec, Design, Acceptance criteria, Notes — stored in
//! `task_agentic_briefs`, one row per Task that has one.
//!
//! Two rules ride on it, both refused out loud (see `docs/spec/resources.md`, "Tasks"):
//!
//! - A Task that reads as Agentic cannot be **started** — moved into In Progress — without a Spec.
//! - An **agentic wait** (an Expectation an agent raised: "the agent is waiting on you") can only
//!   hang directly under a Task that reads as Agentic.

use std::collections::{HashMap, HashSet};

use super::error::TaskError;
use super::model::{AgenticBrief, CommitmentId, GoalId, TaskId};
use super::TaskOperator;
use crate::database::session::{Db, SessionMode};

/// The highest priority number a brief may carry: P4.
const LOWEST_PRIORITY: u8 = 4;

#[derive(sqlx::FromRow)]
struct BriefRow {
    task_id: i64,
    priority: Option<i64>,
    spec: String,
    design: String,
    acceptance: String,
    notes: String,
}

impl From<BriefRow> for AgenticBrief {
    fn from(row: BriefRow) -> Self {
        Self {
            // The CHECK constraint keeps the column in 0–4, so the conversion cannot fail on a
            // row this app wrote; an impossible value reads as no priority rather than a wrong one.
            priority: row
                .priority
                .and_then(|priority| u8::try_from(priority).ok()),
            spec: row.spec,
            design: row.design,
            acceptance: row.acceptance,
            notes: row.notes,
        }
    }
}

/// One step of the Agentic climb: a task's own flag and where it hangs.
#[derive(sqlx::FromRow)]
struct AgenticStepRow {
    agentic: Option<bool>,
    parent_type: String,
    parent_id: i64,
}

const BRIEF_SELECT: &str =
    "SELECT task_id, priority, spec, design, acceptance, notes FROM task_agentic_briefs";

impl TaskOperator<'_> {
    /// A task's agentic brief, or `None` when it has none.
    pub async fn agentic_brief(&mut self, id: TaskId) -> Result<Option<AgenticBrief>, TaskError> {
        let row = sqlx::query_as::<_, BriefRow>(&format!("{BRIEF_SELECT} WHERE task_id = ?"))
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?;
        Ok(row.map(AgenticBrief::from))
    }

    /// Every stored brief, by task id — one query for a whole board load.
    pub async fn agentic_briefs(&mut self) -> Result<HashMap<i64, AgenticBrief>, TaskError> {
        let rows = sqlx::query_as::<_, BriefRow>(BRIEF_SELECT)
            .fetch_all(&mut *self.connection)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.task_id, AgenticBrief::from(row)))
            .collect())
    }

    /// Writes a task's brief — replacing any it had — or removes it for `None`. Writes nothing when
    /// the brief is unchanged, so an edit elsewhere on the task journals no brief row.
    pub(super) async fn write_agentic_brief(
        &mut self,
        id: TaskId,
        brief: &Option<AgenticBrief>,
    ) -> Result<(), TaskError> {
        if self.agentic_brief(id).await? == *brief {
            return Ok(());
        }
        let Some(brief) = brief else {
            sqlx::query("DELETE FROM task_agentic_briefs WHERE task_id = ?")
                .bind(id.0)
                .execute(&mut *self.connection)
                .await?;
            return Ok(());
        };
        sqlx::query(
            "INSERT INTO task_agentic_briefs (task_id, priority, spec, design, acceptance, notes)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (task_id) DO UPDATE SET priority = excluded.priority,
                spec = excluded.spec, design = excluded.design,
                acceptance = excluded.acceptance, notes = excluded.notes",
        )
        .bind(id.0)
        .bind(brief.priority.map(i64::from))
        .bind(&brief.spec)
        .bind(&brief.design)
        .bind(&brief.acceptance)
        .bind(&brief.notes)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// A task's own Agentic column and its parent reference, or `None` when there is no such task.
    async fn agentic_step(&mut self, id: TaskId) -> Result<Option<AgenticStepRow>, TaskError> {
        Ok(sqlx::query_as::<_, AgenticStepRow>(
            "SELECT agentic, parent_type, parent_id FROM tasks WHERE id = ?",
        )
        .bind(id.0)
        .fetch_optional(&mut *self.connection)
        .await?)
    }
}

/// Refuses a brief whose priority is outside P0–P4.
pub(crate) fn validate_brief(brief: &Option<AgenticBrief>) -> Result<(), TaskError> {
    match brief.as_ref().and_then(|brief| brief.priority) {
        Some(priority) if priority > LOWEST_PRIORITY => {
            Err(TaskError::AgenticPriorityOutOfRange(priority))
        }
        _ => Ok(()),
    }
}

/// What a node reads as for Agentic, starting from the node `(node_type, node_id)` itself: the
/// first explicit flag on the way up, or `false` when there is none.
///
/// The flag lives only on Tasks, and inherits *through* the kinds that carry none — a Goal, a
/// Commitment — so the climb passes those on its way. It stops at anything else (a Project, a
/// Domain, an Aspect: no Task ever sits above one), at a missing row, and at a cycle, all of which
/// read as not Agentic.
pub(crate) async fn reads_agentic<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
) -> Result<bool, TaskError> {
    let mut next = (node_type.to_string(), node_id);
    let mut seen: HashSet<(String, i64)> = HashSet::new();
    loop {
        if !seen.insert(next.clone()) {
            return Ok(false);
        }
        let (kind, id) = &next;
        let parent = match kind.as_str() {
            "task" => match db.tasks().agentic_step(TaskId(*id)).await? {
                None => return Ok(false),
                Some(step) => {
                    if let Some(flag) = step.agentic {
                        return Ok(flag);
                    }
                    (step.parent_type, step.parent_id)
                }
            },
            "goal" => match db.goals().ancestry_link(GoalId(*id)).await {
                Ok(link) => (link.parent.node_type, link.parent.node_id),
                Err(TaskError::GoalNotFound(_)) => return Ok(false),
                Err(error) => return Err(error),
            },
            "commitment" => match db.commitments().ancestry_link(CommitmentId(*id)).await {
                Ok(link) => (link.parent.node_type, link.parent.node_id),
                Err(TaskError::CommitmentNotFound(_)) => return Ok(false),
                Err(error) => return Err(error),
            },
            _ => return Ok(false),
        };
        next = parent;
    }
}

/// Refuses to start a Task that reads as Agentic while its brief has no Spec.
///
/// `own` is the Task's own Agentic column as it will be written — `None` inherits from `parent`,
/// the Task's parent reference as it will be written.
pub(crate) async fn require_spec_to_start<M: SessionMode>(
    db: &mut Db<M>,
    own: Option<bool>,
    parent: (&str, i64),
    brief: &Option<AgenticBrief>,
) -> Result<(), TaskError> {
    if brief.as_ref().is_some_and(AgenticBrief::has_spec) {
        return Ok(());
    }
    let agentic = match own {
        Some(flag) => flag,
        None => reads_agentic(db, parent.0, parent.1).await?,
    };
    if agentic {
        return Err(TaskError::AgenticSpecMissing);
    }
    Ok(())
}

/// Refuses an agentic wait anywhere but directly under a Task that reads as Agentic.
pub(crate) async fn require_agentic_parent<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<(), TaskError> {
    if parent_type == "task" && reads_agentic(db, parent_type, parent_id).await? {
        return Ok(());
    }
    Err(TaskError::AgenticWaitOutsideAgenticTask)
}

#[cfg(test)]
mod tests;
