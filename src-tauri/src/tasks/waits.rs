//! A Task's optional **Expectation template**, and the virtual wait it spawns.
//!
//! An Asynchronous Task may carry a template (`task_async_templates`), kept only while the flag is
//! on. While such a Task is **done**, a **virtual** Expectation exists beneath it — derived at read
//! time from "this Task is done and has a template", never stored as an `expectations` row, and
//! begun when the Task was completed (`tasks.done_at`). Completing and reopening the Task, and
//! undoing either, are only the Task's own status change: nothing here is written or removed.
//!
//! What the wait itself has had done to it — released, archived, checked on — lives in an
//! **overlay** keyed by the Task (`spawned_waits`), written only by those gestures. When the wait
//! stops being derived the row is left where it is and ignored, so completing the Task again brings
//! its state back. Arlesh-pnn's virtual node tables (ADR 0008) will generalise this.
//!
//! The same module answers the question both kinds of wait share: **when is the next check due?**
//! A wait with a Check every is checked at its Starting, then one interval after each check made —
//! anchored to when the check was made, not to the schedule, so a late check does not leave a run
//! of overdue ones behind it.

use std::collections::HashMap;

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::database::session::{Db, SessionMode};

use super::error::TaskError;
use super::model::{
    AsyncTemplate, DurationSpec, ExpectationArchival, ExpectationStatus, SpawnedWait, TaskId,
    TimeScope, UpdateSpawnedWaitRequest,
};
use super::TaskOperator;

pub use super::rules::waits::{
    advance_check, check_window, day_of, first_spawned_check, is_due, next_check_due,
    next_spawned_check, spawned_check_due, spawned_key, spawned_schedule, stored_check_due,
    wait_windows, window_from_rule, SpawnedSchedule, WaitProgress, WaitSources,
};

/// How an instant is spelled in a TEXT column: ISO-8601 to the second, no zone.
const INSTANT_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";

/// Spells an instant for a TEXT column.
pub(crate) fn instant_column(at: NaiveDateTime) -> String {
    at.format(INSTANT_FORMAT).to_string()
}

/// Reads an instant from a TEXT column. A value that does not parse reads as absent — the answer
/// that asks for a check rather than hiding one.
pub(crate) fn instant_from_column(value: Option<String>) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value.as_deref()?, INSTANT_FORMAT).ok()
}

/// The stored shape of a template row.
#[derive(sqlx::FromRow)]
struct TemplateRow {
    title: String,
    time_scope_n: Option<i64>,
    time_scope_kind: Option<String>,
    check_every_n: Option<i64>,
    check_every_kind: Option<String>,
}

/// A task's template row, with the task it belongs to, as a whole board reads it.
#[derive(sqlx::FromRow)]
struct KeyedTemplateRow {
    task_id: i64,
    #[sqlx(flatten)]
    template: TemplateRow,
}

/// A derived wait's Task, joined to its overlay if it has one.
#[derive(sqlx::FromRow)]
struct SpawnedRow {
    task_id: i64,
    done_at: Option<String>,
    status: Option<String>,
    archival: Option<String>,
    last_check_at: Option<String>,
}

/// The rows [`SpawnedRow`] reads: every done, Asynchronous Task with a template — the waits that
/// exist — with whatever overlay each has.
const SPAWNED_SELECT: &str = "SELECT t.id AS task_id, t.done_at, o.status, o.archival,
            (SELECT MAX(c.resolved_at) FROM wait_checks c
              WHERE c.wait_kind = 'spawned' AND c.wait_id = t.id) AS last_check_at
     FROM tasks t
     JOIN task_async_templates a ON a.task_id = t.id
     LEFT JOIN spawned_waits o ON o.task_id = t.id
     WHERE t.status IN ('done', 'agentic_done') AND t.asynchronous = 1";

fn duration(n: Option<i64>, kind: Option<String>) -> Option<DurationSpec> {
    Some(DurationSpec { n: n?, kind: kind? })
}

fn columns(spec: &Option<DurationSpec>) -> (Option<i64>, Option<String>) {
    match spec {
        Some(spec) => (Some(spec.n), Some(spec.kind.clone())),
        None => (None, None),
    }
}

impl SpawnedRow {
    /// With no overlay the wait is as it began: pending and live, never checked.
    fn into_wait(self) -> SpawnedWait {
        SpawnedWait {
            task_id: self.task_id,
            spawned_at: instant_from_column(self.done_at),
            status: self
                .status
                .as_deref()
                .and_then(ExpectationStatus::from_db)
                .unwrap_or_default(),
            archival: self
                .archival
                .as_deref()
                .and_then(ExpectationArchival::from_db)
                .unwrap_or_default(),
            last_check_at: instant_from_column(self.last_check_at),
        }
    }
}

impl TaskOperator<'_> {
    /// A task's Expectation template, with its tags, or `None` when it is not Asynchronous.
    pub async fn async_template(&mut self, id: TaskId) -> Result<Option<AsyncTemplate>, TaskError> {
        let Some(row) = sqlx::query_as::<_, TemplateRow>(
            "SELECT title, time_scope_n, time_scope_kind, check_every_n, check_every_kind
             FROM task_async_templates WHERE task_id = ?",
        )
        .bind(id.0)
        .fetch_optional(&mut *self.connection)
        .await?
        else {
            return Ok(None);
        };
        let tag_ids = sqlx::query_scalar(
            "SELECT tag_id FROM tags_on_async_templates WHERE task_id = ? ORDER BY tag_id",
        )
        .bind(id.0)
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(Some(AsyncTemplate {
            title: row.title,
            tag_ids,
            time_scope: duration(row.time_scope_n, row.time_scope_kind),
            check_every: duration(row.check_every_n, row.check_every_kind),
        }))
    }

    /// Writes a task's template — replacing any it had — or removes it for `None`.
    pub(super) async fn write_async_template(
        &mut self,
        id: TaskId,
        template: &Option<AsyncTemplate>,
    ) -> Result<(), TaskError> {
        let stored = self.async_template(id).await?;
        if stored == *template {
            return Ok(());
        }
        sqlx::query("DELETE FROM task_async_templates WHERE task_id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        let Some(template) = template else {
            return Ok(());
        };
        let (ts_n, ts_kind) = columns(&template.time_scope);
        let (ce_n, ce_kind) = columns(&template.check_every);
        sqlx::query(
            "INSERT INTO task_async_templates
                (task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id.0)
        .bind(&template.title)
        .bind(ts_n)
        .bind(&ts_kind)
        .bind(ce_n)
        .bind(&ce_kind)
        .execute(&mut *self.connection)
        .await?;
        for tag_id in &template.tag_ids {
            sqlx::query(
                "INSERT OR IGNORE INTO tags_on_async_templates (task_id, tag_id) VALUES (?, ?)",
            )
            .bind(id.0)
            .bind(tag_id)
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }

    /// The wait a task spawned, while it exists — the task done, Asynchronous and with a template.
    pub async fn spawned_wait(&mut self, id: TaskId) -> Result<Option<SpawnedWait>, TaskError> {
        let row = sqlx::query_as::<_, SpawnedRow>(&format!("{SPAWNED_SELECT} AND t.id = ?"))
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?;
        Ok(row.map(SpawnedRow::into_wait))
    }

    /// Every wait that exists, by task. An overlay whose wait is not derived is not among them.
    pub async fn spawned_waits(&mut self) -> Result<Vec<SpawnedWait>, TaskError> {
        let rows = sqlx::query_as::<_, SpawnedRow>(&format!("{SPAWNED_SELECT} ORDER BY t.id"))
            .fetch_all(&mut *self.connection)
            .await?;
        Ok(rows.into_iter().map(SpawnedRow::into_wait).collect())
    }

    /// Writes a spawned wait's status and archive, starting its overlay if it has none.
    async fn set_spawned_state(
        &mut self,
        id: TaskId,
        status: ExpectationStatus,
        archival: ExpectationArchival,
    ) -> Result<(), TaskError> {
        sqlx::query(
            "INSERT INTO spawned_waits (task_id, status, archival, released_at)
             VALUES (?, ?, ?, CASE WHEN ? = 'released' THEN ? END)
             ON CONFLICT (task_id) DO UPDATE SET status = excluded.status,
                archival = excluded.archival,
                released_at = CASE WHEN excluded.status = 'released'
                                   THEN CASE WHEN spawned_waits.status = 'released'
                                             THEN spawned_waits.released_at
                                             ELSE excluded.released_at END
                                   ELSE NULL END",
        )
        .bind(id.0)
        .bind(status.as_str())
        .bind(archival.as_str())
        .bind(status.as_str())
        .bind(instant_column(super::expectations::now()))
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// A wait's completed checks, oldest first.
    pub async fn wait_checks(&mut self, wait: &WaitRef) -> Result<Vec<CheckRecord>, TaskError> {
        let (wait_id, wait_key) = wait.columns();
        let rows = sqlx::query_as::<_, CheckRow>(
            "SELECT due_at, resolved_at FROM wait_checks
             WHERE wait_kind = ? AND wait_id IS ? AND wait_key IS ? ORDER BY resolved_at, due_at",
        )
        .bind(wait.kind().as_str())
        .bind(wait_id)
        .bind(wait_key)
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows.into_iter().filter_map(CheckRow::into_record).collect())
    }

    /// Every completed check, by the wait it is on, oldest first — what [`Self::wait_checks`] reads
    /// one wait at a time, for a whole board.
    pub async fn all_wait_checks(
        &mut self,
    ) -> Result<HashMap<WaitRef, Vec<CheckRecord>>, TaskError> {
        let rows = sqlx::query_as::<_, KeyedCheckRow>(
            "SELECT wait_kind, wait_id, wait_key, due_at, resolved_at FROM wait_checks
             ORDER BY resolved_at, due_at",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        let mut checks: HashMap<WaitRef, Vec<CheckRecord>> = HashMap::new();
        for row in rows {
            let wait = match (row.wait_kind.as_str(), row.wait_id, row.wait_key) {
                ("stored", Some(id), None) => WaitRef::Stored(id),
                ("spawned", Some(id), None) => WaitRef::Spawned(id),
                ("occurrence", None, Some(key)) => WaitRef::Occurrence(key),
                _ => continue,
            };
            if let Some(record) = row.check.into_record() {
                checks.entry(wait).or_default().push(record);
            }
        }
        Ok(checks)
    }

    /// Every Asynchronous Task's Expectation template, with its tags, by Task id — what
    /// [`Self::async_template`] reads one Task at a time, for a whole board.
    pub async fn async_templates(&mut self) -> Result<HashMap<i64, AsyncTemplate>, TaskError> {
        let rows = sqlx::query_as::<_, KeyedTemplateRow>(
            "SELECT task_id, title, time_scope_n, time_scope_kind, check_every_n, check_every_kind
             FROM task_async_templates",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        let tags: Vec<(i64, i64)> = sqlx::query_as(
            "SELECT task_id, tag_id FROM tags_on_async_templates ORDER BY task_id, tag_id",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        let mut templates: HashMap<i64, AsyncTemplate> = rows
            .into_iter()
            .map(|row| {
                let template = AsyncTemplate {
                    title: row.template.title,
                    tag_ids: Vec::new(),
                    time_scope: duration(row.template.time_scope_n, row.template.time_scope_kind),
                    check_every: duration(
                        row.template.check_every_n,
                        row.template.check_every_kind,
                    ),
                };
                (row.task_id, template)
            })
            .collect();
        for (task_id, tag_id) in tags {
            if let Some(template) = templates.get_mut(&task_id) {
                template.tag_ids.push(tag_id);
            }
        }
        Ok(templates)
    }

    /// Records the check due at `due_at` as completed at `resolved_at`.
    pub(crate) async fn record_check(
        &mut self,
        wait: &WaitRef,
        due_at: NaiveDateTime,
        resolved_at: NaiveDateTime,
    ) -> Result<(), TaskError> {
        let (wait_id, wait_key) = wait.columns();
        sqlx::query(
            "INSERT INTO wait_checks (wait_kind, wait_id, wait_key, due_at, resolved_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(wait.kind().as_str())
        .bind(wait_id)
        .bind(wait_key)
        .bind(instant_column(due_at))
        .bind(instant_column(resolved_at))
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Deletes the completed check due at `due_at`.
    async fn delete_check(
        &mut self,
        wait: &WaitRef,
        due_at: NaiveDateTime,
    ) -> Result<(), TaskError> {
        let (wait_id, wait_key) = wait.columns();
        sqlx::query(
            "DELETE FROM wait_checks
             WHERE wait_kind = ? AND wait_id IS ? AND wait_key IS ? AND due_at = ?",
        )
        .bind(wait.kind().as_str())
        .bind(wait_id)
        .bind(wait_key)
        .bind(instant_column(due_at))
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }
}

/// Which kind of wait a check belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitKind {
    /// A stored Expectation, named by its id.
    Stored,
    /// The wait a stored Asynchronous Task spawned, named by the Task's id.
    Spawned,
    /// The wait a Habit occurrence spawned, named by the occurrence's node key.
    Occurrence,
}

impl WaitKind {
    /// The spelling `wait_checks.wait_kind` stores.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stored => "stored",
            Self::Spawned => "spawned",
            Self::Occurrence => "occurrence",
        }
    }
}

/// One wait, as the checks on it name it: a stored Expectation, the wait a stored Task spawned,
/// or the wait a Habit occurrence spawned.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum WaitRef {
    /// A stored Expectation.
    Stored(i64),
    /// The wait a stored Task spawned, by the Task.
    Spawned(i64),
    /// The wait a Habit occurrence spawned, by the occurrence's canonical node key.
    Occurrence(String),
}

impl WaitRef {
    /// Which kind of wait this is.
    pub fn kind(&self) -> WaitKind {
        match self {
            Self::Stored(_) => WaitKind::Stored,
            Self::Spawned(_) => WaitKind::Spawned,
            Self::Occurrence(_) => WaitKind::Occurrence,
        }
    }

    /// The `wait_checks` columns naming it: an integer id, or an occurrence's key.
    fn columns(&self) -> (Option<i64>, Option<&str>) {
        match self {
            Self::Stored(id) | Self::Spawned(id) => (Some(*id), None),
            Self::Occurrence(key) => (None, Some(key.as_str())),
        }
    }

    /// Its canonical spelling, `stored:5` / `spawned:5` / `occurrence:{node key}`.
    pub fn spelling(&self) -> String {
        match self {
            Self::Stored(id) | Self::Spawned(id) => format!("{}:{id}", self.kind().as_str()),
            Self::Occurrence(key) => format!("occurrence:{key}"),
        }
    }

    /// Parses [`Self::spelling`].
    pub fn parse(spelling: &str) -> Option<Self> {
        let (kind, rest) = spelling.split_once(':')?;
        match kind {
            "stored" => rest.parse().ok().map(Self::Stored),
            "spawned" => rest.parse().ok().map(Self::Spawned),
            "occurrence" => Some(Self::Occurrence(rest.to_string())),
            _ => None,
        }
    }
}

/// A completed check, as stored.
#[derive(sqlx::FromRow)]
struct CheckRow {
    due_at: String,
    resolved_at: String,
}

impl CheckRow {
    fn into_record(self) -> Option<CheckRecord> {
        Some(CheckRecord {
            due_at: instant_from_column(Some(self.due_at))?,
            resolved_at: instant_from_column(Some(self.resolved_at))?,
        })
    }
}

/// A completed check, with the wait it is on, as a whole board reads it.
#[derive(sqlx::FromRow)]
struct KeyedCheckRow {
    wait_kind: String,
    wait_id: Option<i64>,
    wait_key: Option<String>,
    #[sqlx(flatten)]
    check: CheckRow,
}

/// One completed check on a wait.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CheckRecord {
    /// When it fell due — which check it was.
    pub due_at: NaiveDateTime,
    /// When it was completed.
    pub resolved_at: NaiveDateTime,
}

/// Takes the wait's latest completed check back, if `due_at` names it; refused otherwise. The
/// schedule runs on from the latest completion, so reopening it makes it the check due again and
/// the one after it — no longer due — goes. An older check cannot be reopened: the checks after it
/// stand, and it would have nowhere to be drawn.
pub(crate) async fn reopen_latest<M: SessionMode>(
    db: &mut Db<M>,
    wait: &WaitRef,
    due_at: NaiveDateTime,
) -> Result<(), TaskError> {
    let latest = db.tasks().wait_checks(wait).await?.pop();
    if latest.is_none_or(|latest| latest.due_at != due_at) {
        return Err(TaskError::CheckNotReopenable);
    }
    db.tasks().delete_check(wait, due_at).await
}

/// A stored Expectation's next check, as the window its virtual check task is drawn in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExpectationCheck {
    /// The Expectation being checked on.
    pub expectation_id: i64,
    /// The Day the check fell due on.
    pub due: TimeScope,
    /// When it fell due — which check it is.
    pub due_at: NaiveDateTime,
    /// When it was completed; absent on the one check that is due and open.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<NaiveDateTime>,
}

/// A completed check on a spawned wait, drawn as a done check task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DoneCheck {
    /// The Day it fell due on.
    pub due: TimeScope,
    /// When it fell due.
    pub due_at: NaiveDateTime,
    /// When it was completed.
    pub resolved_at: NaiveDateTime,
}

/// A Task's spawned wait as the views draw it: the overlay, plus what the template makes of it —
/// its Time Scope (the template's rule, counted from the day it began) and its next check — each
/// under what the wait's own Expectation overlay says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpawnedWaitView {
    /// The overlay itself.
    #[serde(flatten)]
    pub wait: SpawnedWait,
    /// Its Time Scope: its own, or the template's rule's.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_scope: Option<TimeScope>,
    /// Its Check every: its own, or the template's.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_every: Option<DurationSpec>,
    /// When its first check falls due, while it is checked on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_starting: Option<NaiveDateTime>,
    /// The Day its current check fell due on, while one is due and open.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_check: Option<TimeScope>,
    /// When that check fell due.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_check_at: Option<NaiveDateTime>,
    /// Its completed checks during this completion of the Task, oldest first.
    #[serde(default)]
    pub done_checks: Vec<DoneCheck>,
}

/// Every wait's derived windows at one load: the stored Expectations' next checks, and each
/// spawned wait with its window and next check.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct WaitWindows {
    /// Each stored Expectation with a check due.
    pub expectation_checks: Vec<ExpectationCheck>,
    /// Each spawned wait whose Task still carries its template.
    pub spawned_waits: Vec<SpawnedWaitView>,
}

/// Derives [`WaitWindows`] at `now`. A check is listed only once it is due — its check task exists
/// from then until it is completed — and a wait that is released or archived has none: once it is
/// over, nothing more is generated.
pub async fn derive_wait_windows<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
) -> Result<WaitWindows, TaskError> {
    let expectations = db.expectations().list().await?;
    let checks = db.tasks().all_wait_checks().await?;
    let spawned = db.tasks().spawned_waits().await?;
    let templates = db.tasks().async_templates().await?;
    let overlays = db.overlays().expectations().await?;
    wait_windows(
        &WaitSources {
            expectations: &expectations,
            checks: &checks,
            spawned: &spawned,
            templates: &templates,
            overlays: &overlays,
        },
        now,
    )
}

/// Releases, un-releases or archives a task's spawned wait. Refused when there is none — the task
/// not done, not Asynchronous, or without a template.
#[tracing::instrument(skip(db))]
pub async fn update_spawned_wait<M: SessionMode>(
    db: &mut Db<M>,
    task: TaskId,
    request: UpdateSpawnedWaitRequest,
) -> Result<SpawnedWait, TaskError> {
    let stored = db
        .tasks()
        .spawned_wait(task)
        .await?
        .ok_or(TaskError::NoSpawnedWait(task.0))?;
    let status = request.status.unwrap_or(stored.status);
    let archival = request.archival.unwrap_or(stored.archival);
    db.tasks().set_spawned_state(task, status, archival).await?;
    Ok(SpawnedWait {
        status,
        archival,
        ..stored
    })
}

/// Completes the current check on a task's spawned wait: records `at` as its last check, so the
/// next falls due one interval later. Refused when no check is due at `at` — no pending, live wait
/// with a Check every, or its next check not come round yet.
#[tracing::instrument(skip(db))]
pub async fn complete_spawned_check<M: SessionMode>(
    db: &mut Db<M>,
    task: TaskId,
    at: NaiveDateTime,
) -> Result<(), TaskError> {
    let wait = db
        .tasks()
        .spawned_wait(task)
        .await?
        .ok_or(TaskError::NoSpawnedWait(task.0))?;
    let overlay = db.overlays().expectation(&spawned_key(task.0)).await?;
    let schedule = match db.tasks().async_template(task).await? {
        Some(template) => spawned_schedule(&template, wait.spawned_at, &overlay)?,
        None => SpawnedSchedule::default(),
    };
    let progress = WaitProgress {
        check_starting: schedule.check_starting,
        ..WaitProgress::of(&wait)
    };
    let Some(due) = schedule
        .check_every
        .and_then(|every| next_spawned_check(&progress, &every, at))
        .filter(|due| is_due(*due, at))
    else {
        return Err(TaskError::NoCheckDue);
    };
    db.tasks()
        .record_check(&WaitRef::Spawned(task.0), due, at)
        .await
}

/// Takes the latest completed check on a task's spawned wait back — see [`reopen_latest`].
/// Refused unless the wait exists and is pending and live.
#[tracing::instrument(skip(db))]
pub async fn reopen_spawned_check<M: SessionMode>(
    db: &mut Db<M>,
    task: TaskId,
    due_at: NaiveDateTime,
) -> Result<(), TaskError> {
    let wait = db
        .tasks()
        .spawned_wait(task)
        .await?
        .ok_or(TaskError::NoSpawnedWait(task.0))?;
    if wait.status != ExpectationStatus::Pending || wait.archival != ExpectationArchival::Live {
        return Err(TaskError::CheckNotReopenable);
    }
    reopen_latest(db, &WaitRef::Spawned(task.0), due_at).await
}

#[cfg(test)]
mod tests;
