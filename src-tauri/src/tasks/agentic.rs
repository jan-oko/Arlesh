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
use super::model::{AgenticBrief, AgenticPriority, CommitmentId, GoalId, TaskId};
use super::TaskOperator;
use crate::database::session::{Db, SessionMode};
use crate::nodes::key::{OccurrenceKey, TemplateItem, TemplateKind, NO_CYCLE};
use crate::scopes::key::ScopeKey;

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
            priority: row.priority.and_then(AgenticPriority::from_rank),
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
        .bind(brief.priority.map(AgenticPriority::rank))
        .bind(&brief.spec)
        .bind(&brief.design)
        .bind(&brief.acceptance)
        .bind(&brief.notes)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// The canonical key of the Habit occurrence a stored row of `kind` hangs on, if it hangs on
    /// one.
    async fn occurrence_holding(
        &mut self,
        kind: &str,
        id: i64,
    ) -> Result<Option<String>, TaskError> {
        Ok(sqlx::query_scalar(
            "SELECT parent_key FROM derived_children WHERE child_type = ? AND child_id = ?",
        )
        .bind(kind)
        .bind(id)
        .fetch_optional(&mut *self.connection)
        .await?)
    }

    /// An occurrence's own Agentic value: its overlay's when it sets one — which may be Inherit,
    /// read as `None` — else its template's column. Only a Task template has the column.
    async fn occurrence_own_agentic(
        &mut self,
        key: &OccurrenceKey,
    ) -> Result<Option<bool>, TaskError> {
        let overlay: Option<(Option<bool>, bool)> =
            sqlx::query_as("SELECT agentic, agentic_set FROM task_overlays WHERE node_key = ?")
                .bind(key.node_key())
                .fetch_optional(&mut *self.connection)
                .await?;
        if let Some((agentic, true)) = overlay {
            return Ok(agentic);
        }
        let template: Option<Option<bool>> = match key.item.item_type {
            TemplateKind::FlowTask => {
                sqlx::query_scalar("SELECT agentic FROM flow_tasks WHERE id = ?")
                    .bind(key.item.item_id)
                    .fetch_optional(&mut *self.connection)
                    .await?
            }
            TemplateKind::FlowRoot => {
                sqlx::query_scalar(
                    "SELECT agentic FROM flows WHERE id = ? AND instance_type = 'task'",
                )
                .bind(key.item.item_id)
                .fetch_optional(&mut *self.connection)
                .await?
            }
            TemplateKind::FlowGoal => None,
        };
        Ok(template.flatten())
    }

    /// What a template row hangs under, or `None` when the row is gone.
    async fn template_parent(
        &mut self,
        item: TemplateItem,
    ) -> Result<Option<TemplateParent>, TaskError> {
        let table = match item.item_type {
            TemplateKind::FlowTask => "flow_tasks",
            TemplateKind::FlowGoal => "flow_goals",
            TemplateKind::FlowRoot => {
                let row: Option<(Option<String>, Option<i64>, String, i64)> = sqlx::query_as(
                    "SELECT target_type, target_id, parent_type, parent_id FROM flows WHERE id = ?",
                )
                .bind(item.item_id)
                .fetch_optional(&mut *self.connection)
                .await?;
                // The host an iteration's root renders under: the Target Node, else the Flow's
                // parent — spelled as a child row's parent type, as `occurrence_edit::host_of` does.
                return Ok(row.map(|(target_type, target_id, parent_type, parent_id)| {
                    let (kind, id) = match (target_type, target_id) {
                        (Some(kind), Some(id)) => (kind, id),
                        _ => (parent_type, parent_id),
                    };
                    let kind = match kind.as_str() {
                        "goal" | "task" => kind,
                        _ => "project".to_string(),
                    };
                    TemplateParent::Host(kind, id)
                }));
            }
        };
        let row: Option<(String, i64)> = sqlx::query_as(&format!(
            "SELECT parent_type, parent_id FROM {table} WHERE id = ?"
        ))
        .bind(item.item_id)
        .fetch_optional(&mut *self.connection)
        .await?;
        Ok(row.and_then(|(parent_type, parent_id)| {
            let item_type = match parent_type.as_str() {
                "flow" => TemplateKind::FlowRoot,
                "flow_task" => TemplateKind::FlowTask,
                "flow_goal" => TemplateKind::FlowGoal,
                _ => return None,
            };
            Some(TemplateParent::Item(TemplateItem {
                item_type,
                item_id: parent_id,
            }))
        }))
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

/// Where the Agentic climb is: at a stored row, or at a Habit occurrence's template row within one
/// iteration.
enum Cursor {
    Stored(String, i64),
    Template {
        item: TemplateItem,
        iteration: ScopeKey,
        cycle: i64,
        /// Whether to skip this row's own value and start at its parent — for an occurrence being
        /// set back to Inherit in the very write being checked.
        skip_own: bool,
    },
}

/// What a node reads as for Agentic, starting from the node `(node_type, node_id)` itself: the
/// first explicit flag on the way up, or `false` when there is none.
///
/// **The one resolver**, and it climbs the tree the app draws, so the backend and the app never
/// disagree about the same fact:
///
/// - A stored row reads its own flag (only a Task has one), then its parent — and a row hung on a
///   Habit occurrence has the occurrence for its parent, not the host its columns name.
/// - An occurrence reads its own value — its overlay's, else its template's — then its template's
///   parent within the same iteration (an item's parent item, or the iteration's root), and from
///   the root the Habit's host.
///
/// Inherits *through* the kinds that carry no flag — a Goal, a Commitment, a goal item — and stops
/// at anything else (a Project, a Domain, an Aspect: no Task ever sits above one), at a missing
/// row, and at a cycle, all of which read as not Agentic.
pub(crate) async fn reads_agentic<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
) -> Result<bool, TaskError> {
    climb(db, Cursor::Stored(node_type.to_string(), node_id)).await
}

/// What a Habit occurrence reads as for Agentic — see [`reads_agentic`].
pub(crate) async fn occurrence_reads_agentic<M: SessionMode>(
    db: &mut Db<M>,
    key: &OccurrenceKey,
) -> Result<bool, TaskError> {
    climb(db, occurrence_cursor(key, false)).await
}

/// What a Habit occurrence would read as with no flag of its own — its template tree and host.
pub(crate) async fn occurrence_inherits_agentic<M: SessionMode>(
    db: &mut Db<M>,
    key: &OccurrenceKey,
) -> Result<bool, TaskError> {
    climb(db, occurrence_cursor(key, true)).await
}

fn occurrence_cursor(key: &OccurrenceKey, skip_own: bool) -> Cursor {
    Cursor::Template {
        item: key.item,
        iteration: key.iteration,
        cycle: key.cycle,
        skip_own,
    }
}

async fn climb<M: SessionMode>(db: &mut Db<M>, start: Cursor) -> Result<bool, TaskError> {
    let mut cursor = start;
    let mut seen_stored: HashSet<(String, i64)> = HashSet::new();
    let mut seen_template: HashSet<TemplateItem> = HashSet::new();
    loop {
        cursor = match cursor {
            Cursor::Stored(kind, id) => {
                if !seen_stored.insert((kind.clone(), id)) {
                    return Ok(false);
                }
                let parent = match kind.as_str() {
                    "task" => match db.tasks().agentic_step(TaskId(id)).await? {
                        None => return Ok(false),
                        Some(step) => {
                            if let Some(flag) = step.agentic {
                                return Ok(flag);
                            }
                            (step.parent_type, step.parent_id)
                        }
                    },
                    "goal" => match db.goals().ancestry_link(GoalId(id)).await {
                        Ok(link) => (link.parent.node_type, link.parent.node_id),
                        Err(TaskError::GoalNotFound(_)) => return Ok(false),
                        Err(error) => return Err(error),
                    },
                    "commitment" => match db.commitments().ancestry_link(CommitmentId(id)).await {
                        Ok(link) => (link.parent.node_type, link.parent.node_id),
                        Err(TaskError::CommitmentNotFound(_)) => return Ok(false),
                        Err(error) => return Err(error),
                    },
                    _ => return Ok(false),
                };
                // A row hung on an occurrence climbs into the occurrence, as the app draws it.
                match db
                    .tasks()
                    .occurrence_holding(&kind, id)
                    .await?
                    .and_then(|parent_key| OccurrenceKey::parse(&parent_key))
                {
                    Some(key) => occurrence_cursor(&key, false),
                    None => Cursor::Stored(parent.0, parent.1),
                }
            }
            Cursor::Template {
                item,
                iteration,
                cycle,
                skip_own,
            } => {
                if !seen_template.insert(item) {
                    return Ok(false);
                }
                if !skip_own {
                    let here = OccurrenceKey {
                        item,
                        iteration,
                        cycle,
                    };
                    if let Some(flag) = db.tasks().occurrence_own_agentic(&here).await? {
                        return Ok(flag);
                    }
                }
                match db.tasks().template_parent(item).await? {
                    None => return Ok(false),
                    Some(TemplateParent::Item(parent)) => Cursor::Template {
                        item: parent,
                        iteration,
                        // An iteration's root is drawn by no cycle pair.
                        cycle: if parent.item_type == TemplateKind::FlowRoot {
                            NO_CYCLE
                        } else {
                            cycle
                        },
                        skip_own: false,
                    },
                    Some(TemplateParent::Host(kind, id)) => Cursor::Stored(kind, id),
                }
            }
        };
    }
}

/// What a template row hangs under: another template row, or — for an iteration's root — the
/// Habit's host.
enum TemplateParent {
    Item(TemplateItem),
    Host(String, i64),
}

/// Refuses to start a Task that reads as Agentic while its brief has no Spec.
///
/// `own` is the Task's own Agentic column as it will be written — `None` inherits from above:
/// from the Habit occurrence `task` hangs on, when it hangs on one, else from `parent`, the Task's
/// parent reference as it will be written. A Task being created has no id yet (`task: None`).
pub(crate) async fn require_spec_to_start<M: SessionMode>(
    db: &mut Db<M>,
    task: Option<TaskId>,
    own: Option<bool>,
    parent: (&str, i64),
    brief: &Option<AgenticBrief>,
) -> Result<(), TaskError> {
    if brief.as_ref().is_some_and(AgenticBrief::has_spec) {
        return Ok(());
    }
    let agentic = match own {
        Some(flag) => flag,
        None => {
            let hung_on = match task {
                Some(id) => db
                    .tasks()
                    .occurrence_holding("task", id.0)
                    .await?
                    .and_then(|parent_key| OccurrenceKey::parse(&parent_key)),
                None => None,
            };
            match hung_on {
                Some(key) => occurrence_reads_agentic(db, &key).await?,
                None => reads_agentic(db, parent.0, parent.1).await?,
            }
        }
    };
    require_spec(agentic, brief)
}

/// Refuses to start something that reads as Agentic, `agentic` already resolved, while `brief` has
/// no Spec.
pub(crate) fn require_spec(agentic: bool, brief: &Option<AgenticBrief>) -> Result<(), TaskError> {
    if agentic && !brief.as_ref().is_some_and(AgenticBrief::has_spec) {
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
