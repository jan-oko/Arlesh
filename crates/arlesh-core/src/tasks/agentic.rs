//! Agentic as an object: the brief a Task carries for an agent, and the rules the flag enforces.
//!
//! The **flag** (`tasks.agentic`) is unchanged: three-state and inherited, a Task with no value of
//! its own reading its nearest flagged ancestor. The **brief** is the Task's own and never
//! inherited — priority, Spec, Design, Acceptance criteria, Notes — stored in
//! `task_agentic_briefs`, one row per Task that has one.
//!
//! Two rules ride on it, both refused out loud (see `docs/spec/resources.md`, "Tasks"):
//!
//! - A Task that reads as Agentic cannot be **started** — claimed into On Agent, or taken into
//!   Doing — without a Spec.
//!
//! And it decides which **status model** a Task holds — the Agentic one or the ordinary one (see
//! [`Status`]) — so a change of kind converts statuses here ([`reconcile`]).
//! - An **agentic wait** (an Expectation an agent raised: "the agent is waiting on you") can only
//!   hang directly under a Task that reads as Agentic.

use std::collections::{HashMap, HashSet};

use std::collections::VecDeque;

use super::error::TaskError;
use super::model::{AgenticBrief, AgenticPriority, CommitmentId, GoalId, Status, TaskId};

use super::rules::agentic::{
    occurrence_cursor, AgenticClimb, AgenticStep, Cursor, StoredRead, TemplateParent,
};
pub(crate) use super::rules::agentic::{require_spec, settle_status, stranded};
use super::TaskOperator;
use crate::database::session::{Db, SessionMode};
use crate::nodes::key::{OccurrenceKey, TemplateItem, TemplateKind};
use crate::nodes::rules::parenting::stored_reference;

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
            TemplateKind::FlowGoal
            | TemplateKind::FlowCommitment
            | TemplateKind::FlowExpectation => None,
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
            TemplateKind::FlowCommitment => "flow_commitments",
            TemplateKind::FlowExpectation => "flow_expectations",
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
                        _ => "domain".to_string(),
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
                "flow_commitment" => TemplateKind::FlowCommitment,
                "flow_expectation" => TemplateKind::FlowExpectation,
                _ => return None,
            };
            Some(TemplateParent::Item(TemplateItem {
                item_type,
                item_id: parent_id,
            }))
        }))
    }

    /// Writes a Task's status alone — a conversion between the two models, which keeps whether it
    /// is done and so its `done_at`. Module-private to the reconciliation that is its one caller.
    async fn write_status(&mut self, id: TaskId, status: Status) -> Result<(), TaskError> {
        let spelling = status.as_db().ok_or(TaskError::ReviewIsDerived)?;
        sqlx::query("UPDATE tasks SET status = ? WHERE id = ?")
            .bind(spelling)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// The Habits whose occurrences render under the node `(kind, id)`: its Target Node, or —
    /// with none — its parent.
    async fn habits_hosted_on(&mut self, kind: &str, id: i64) -> Result<Vec<i64>, TaskError> {
        Ok(sqlx::query_scalar(
            "SELECT id FROM flows
              WHERE COALESCE(target_type, parent_type) = ? AND COALESCE(target_id, parent_id) = ?",
        )
        .bind(stored_reference(kind))
        .bind(id)
        .fetch_all(&mut *self.connection)
        .await?)
    }

    /// The stored rows hung on one Habit's occurrences, as `(kind, id)`.
    async fn hung_on_habit(&mut self, flow: i64) -> Result<Vec<(String, i64)>, TaskError> {
        Ok(
            sqlx::query_as("SELECT child_type, child_id FROM derived_children WHERE flow_id = ?")
                .bind(flow)
                .fetch_all(&mut *self.connection)
                .await?,
        )
    }

    /// A Habit's title, to name one of its occurrences in a refusal.
    async fn habit_title(&mut self, flow: i64) -> Result<String, TaskError> {
        Ok(
            sqlx::query_scalar::<_, String>("SELECT title FROM flows WHERE id = ?")
                .bind(flow)
                .fetch_optional(&mut *self.connection)
                .await?
                .unwrap_or_default(),
        )
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

async fn climb<M: SessionMode>(db: &mut Db<M>, start: Cursor) -> Result<bool, TaskError> {
    let mut climb = AgenticClimb::new(start);
    loop {
        let answer = match climb.step() {
            AgenticStep::Done(answer) => return Ok(answer),
            AgenticStep::Stored(kind, id) => {
                let found = match kind.as_str() {
                    "task" => db
                        .tasks()
                        .agentic_step(TaskId(id))
                        .await?
                        .map(|step| (step.agentic, (step.parent_type, step.parent_id))),
                    "goal" => match db.goals().ancestry_link(GoalId(id)).await {
                        Ok(link) => Some((None, (link.parent.node_type, link.parent.node_id))),
                        Err(TaskError::GoalNotFound(_)) => None,
                        Err(error) => return Err(error),
                    },
                    _ => match db.commitments().ancestry_link(CommitmentId(id)).await {
                        Ok(link) => Some((None, (link.parent.node_type, link.parent.node_id))),
                        Err(TaskError::CommitmentNotFound(_)) => None,
                        Err(error) => return Err(error),
                    },
                };
                let read = match found {
                    None => StoredRead::Missing,
                    // Its own flag answers without reading what it hangs on.
                    Some((Some(flag), parent)) => StoredRead::Found {
                        flag: Some(flag),
                        parent,
                        holding: None,
                    },
                    Some((None, parent)) => StoredRead::Found {
                        flag: None,
                        parent,
                        holding: db
                            .tasks()
                            .occurrence_holding(&kind, id)
                            .await?
                            .and_then(|parent_key| OccurrenceKey::parse(&parent_key)),
                    },
                };
                climb.stored(read)
            }
            AgenticStep::Template { key, skip_own } => {
                let own = if skip_own {
                    None
                } else {
                    db.tasks().occurrence_own_agentic(&key).await?
                };
                let parent = if own.is_some() {
                    None
                } else {
                    db.tasks().template_parent(key.item).await?
                };
                climb.template(&key, own, parent)
            }
        };
        if let Some(answer) = answer {
            return Ok(answer);
        }
    }
}

/// What a Task reads as for Agentic as it will be written: `own` is its own Agentic column as
/// written — `None` inherits from above: from the Habit occurrence `task` hangs on, when it hangs
/// on one, else from `parent`, the Task's parent reference as written. A Task being created has no
/// id yet (`task: None`).
///
/// This is what decides which status model the Task holds (see [`Status`]).
pub(crate) async fn resolves_agentic<M: SessionMode>(
    db: &mut Db<M>,
    task: Option<TaskId>,
    own: Option<bool>,
    parent: (&str, i64),
) -> Result<bool, TaskError> {
    if let Some(flag) = own {
        return Ok(flag);
    }
    let hung_on = match task {
        Some(id) => db
            .tasks()
            .occurrence_holding("task", id.0)
            .await?
            .and_then(|parent_key| OccurrenceKey::parse(&parent_key)),
        None => None,
    };
    match hung_on {
        Some(key) => occurrence_reads_agentic(db, &key).await,
        None => reads_agentic(db, parent.0, parent.1).await,
    }
}

/// Where a [`reconcile`] walk starts, or what it reaches next.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Reach {
    /// Everything stored beneath a Task, Goal or Commitment, and every Habit hosted on it.
    Below(String, i64),
    /// One stored Task that inherits its kind: itself, then everything beneath it.
    Task(i64),
    /// One Habit's occurrences, and the stored rows hung on them.
    Habit(i64),
}

/// Re-reads the kind of every Task a change of kind can reach from `start` — a flag changed, a
/// node moved under another ancestor, a template's or an occurrence's flag changed — and converts
/// each status that is now in the wrong model into its counterpart (see [`settle_status`]).
///
/// A Task with an Agentic flag of its own keeps its kind whatever its ancestors say, so the walk
/// stops at one. Run **after** the write, inside the same transaction: when any Task reached has no
/// counterpart for its status, it is refused as [`TaskError::KindConversion`], naming every one,
/// and the caller's transaction takes the whole write back.
pub(crate) async fn reconcile<M: SessionMode>(
    db: &mut Db<M>,
    start: Vec<Reach>,
) -> Result<(), TaskError> {
    let mut queue: VecDeque<Reach> = start.into();
    let mut seen: HashSet<Reach> = HashSet::new();
    let mut refused: Vec<String> = Vec::new();
    while let Some(reach) = queue.pop_front() {
        if !seen.insert(reach.clone()) {
            continue;
        }
        match reach {
            Reach::Below(kind, id) => {
                for task in db.tasks().child_ids(&kind, id).await? {
                    queue.push_back(Reach::Task(task));
                }
                for goal in db.goals().child_ids(&kind, id).await? {
                    queue.push_back(Reach::Below("goal".to_string(), goal));
                }
                for commitment in db.commitments().child_ids(&kind, id).await? {
                    queue.push_back(Reach::Below("commitment".to_string(), commitment));
                }
                for flow in db.tasks().habits_hosted_on(&kind, id).await? {
                    queue.push_back(Reach::Habit(flow));
                }
            }
            Reach::Task(id) => {
                let task = db.tasks().get(TaskId(id)).await?;
                if task.agentic.is_some() {
                    continue;
                }
                let agentic = reads_agentic(db, "task", id).await?;
                if task.status.is_agentic() != agentic {
                    match task.status.converted(agentic) {
                        Some(next) => db.tasks().write_status(TaskId(id), next).await?,
                        None => refused.push(stranded(&task.title, task.status)),
                    }
                }
                queue.push_back(Reach::Below("task".to_string(), id));
            }
            Reach::Habit(flow) => {
                reconcile_occurrences(db, flow, &mut refused).await?;
                for (kind, id) in db.tasks().hung_on_habit(flow).await? {
                    match kind.as_str() {
                        "task" => queue.push_back(Reach::Task(id)),
                        "goal" | "commitment" => queue.push_back(Reach::Below(kind, id)),
                        _ => {}
                    }
                }
            }
        }
    }
    if refused.is_empty() {
        return Ok(());
    }
    Err(TaskError::KindConversion(refused.join(", ")))
}

/// Converts the status each of one Habit's Task occurrences holds in its overlay into the model it
/// reads as now, collecting the ones with no counterpart into `refused`. An overlay with no status
/// is To Do in either model and needs nothing.
async fn reconcile_occurrences<M: SessionMode>(
    db: &mut Db<M>,
    flow: i64,
    refused: &mut Vec<String>,
) -> Result<(), TaskError> {
    let overlays = db.overlays().for_habit(flow).await?.tasks;
    for (node_key, mut overlay) in overlays {
        let Some(stored) = overlay.status.as_deref().and_then(Status::from_db) else {
            continue;
        };
        let Some(key) = OccurrenceKey::parse(&node_key) else {
            continue;
        };
        let agentic = occurrence_reads_agentic(db, &key).await?;
        if stored.is_agentic() == agentic {
            continue;
        }
        match stored.converted(agentic) {
            Some(next) => {
                overlay.status = next.as_db().map(str::to_string);
                db.overlays().put_task(flow, &key, &overlay).await?;
            }
            None => {
                let title = match overlay.title.clone() {
                    Some(title) => title,
                    None => db.tasks().habit_title(flow).await?,
                };
                refused.push(stranded(&title, stored));
            }
        }
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
