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

use chrono::{NaiveDate, NaiveDateTime};
use serde::Serialize;

use crate::database::session::{Db, SessionMode};
use crate::scopes::model::ScopeKind;
use crate::scopes::resolve::DAY_BOUNDARY_HOUR;

use super::error::TaskError;
use super::lifecycle::advance_by;
use super::model::{
    AsyncTemplate, DurationSpec, Expectation, ExpectationArchival, ExpectationStatus, SpawnedWait,
    TaskId, TimeScope, UpdateSpawnedWaitRequest,
};
use super::TaskOperator;

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

/// When the next check on a wait falls due: at `starting` until a check is made, then one
/// `every` after the last one. `None` for a Duration this calendar cannot count.
pub fn next_check_due(
    every: &DurationSpec,
    starting: NaiveDateTime,
    last_check_at: Option<NaiveDateTime>,
) -> Option<NaiveDateTime> {
    match last_check_at {
        None => Some(starting),
        Some(last) => advance_by(last, every.n, &every.kind),
    }
}

/// The scope kind a Duration counts in, if it is one of the four coarse ones.
fn scope_kind(kind: &str) -> Option<ScopeKind> {
    match kind {
        "day" => Some(ScopeKind::Day),
        "week" => Some(ScopeKind::Week),
        "month" => Some(ScopeKind::Month),
        "season" => Some(ScopeKind::Season),
        _ => None,
    }
}

/// The Day an instant falls in. A Day runs 02:00 → 02:00 (see
/// [`crate::scopes::resolve::DAY_BOUNDARY_HOUR`]), so 01:00 on the 5th is still the 4th: reading the
/// calendar date instead drew a check due just after midnight on the day before.
pub fn day_of(at: NaiveDateTime) -> NaiveDate {
    (at - chrono::Duration::hours(i64::from(DAY_BOUNDARY_HOUR))).date()
}

/// Whether a check due at `due` exists yet. A check task is drawn from the moment its check is
/// due, never before: a wait whose checks start tomorrow has nothing to check today.
pub fn is_due(due: NaiveDateTime, now: NaiveDateTime) -> bool {
    due <= now
}

/// When a stored wait's current check fell due — `None` while it is not checked on, or no longer
/// pending and live.
pub fn stored_check_due(expectation: &Expectation) -> Option<NaiveDateTime> {
    let (Some(every), Some(starting)) = (&expectation.check_every, expectation.check_starting)
    else {
        return None;
    };
    if expectation.status != ExpectationStatus::Pending
        || expectation.archival != ExpectationArchival::Live
    {
        return None;
    }
    next_check_due(every, starting, expectation.last_check_at)
}

/// When a spawned wait's current check fell due, given its template's Check every. Its first check
/// is one interval after it began, not at once: the email has only just been sent. A completion
/// never recorded asks for one at `now`. A check made during an earlier completion, kept by the
/// overlay, is not a check on this one.
pub fn spawned_check_due(
    wait: &SpawnedWait,
    every: &DurationSpec,
    now: NaiveDateTime,
) -> Option<NaiveDateTime> {
    if wait.status != ExpectationStatus::Pending || wait.archival != ExpectationArchival::Live {
        return None;
    }
    let starting = match wait.spawned_at {
        Some(began) => advance_by(began, every.n, &every.kind)?,
        None => now,
    };
    let last = wait
        .last_check_at
        .filter(|last| wait.spawned_at.is_none_or(|began| *last >= began));
    next_check_due(every, starting, last)
}

/// The single-day Time Scope a check due at `due` is drawn in — minting the day's scope row.
pub async fn check_window<M: SessionMode>(
    db: &mut Db<M>,
    due: NaiveDateTime,
) -> Result<TimeScope, TaskError> {
    let day = db
        .scopes()
        .get_or_create(ScopeKind::Day, day_of(due))
        .await?;
    Ok(TimeScope {
        start_id: day.id,
        end_id: day.id,
        duration: None,
    })
}

/// The Time Scope a template's **rule** gives a wait that began on `from`: N of the kind, the first
/// being the one `from` falls in. `None` for a kind that cannot be counted.
pub async fn window_from_rule<M: SessionMode>(
    db: &mut Db<M>,
    rule: &DurationSpec,
    from: NaiveDate,
) -> Result<Option<TimeScope>, TaskError> {
    let Some(kind) = scope_kind(&rule.kind) else {
        return Ok(None);
    };
    let start_at = from.and_hms_opt(12, 0, 0).unwrap_or_default();
    let Some(last) = advance_by(start_at, (rule.n - 1).max(0), &rule.kind) else {
        return Ok(None);
    };
    let start = db.scopes().get_or_create(kind, from).await?;
    let end = db.scopes().get_or_create(kind, last.date()).await?;
    Ok(Some(TimeScope {
        start_id: start.id,
        end_id: end.id,
        duration: Some(rule.clone()),
    }))
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
const SPAWNED_SELECT: &str =
    "SELECT t.id AS task_id, t.done_at, o.status, o.archival, o.last_check_at
     FROM tasks t
     JOIN task_async_templates a ON a.task_id = t.id
     LEFT JOIN spawned_waits o ON o.task_id = t.id
     WHERE t.status = 'done' AND t.asynchronous = 1";

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
            "INSERT INTO spawned_waits (task_id, status, archival) VALUES (?, ?, ?)
             ON CONFLICT (task_id) DO UPDATE SET status = excluded.status, archival = excluded.archival",
        )
        .bind(id.0)
        .bind(status.as_str())
        .bind(archival.as_str())
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Records `at` as the time of a spawned wait's last check, starting its overlay if it has none.
    async fn set_spawned_check(&mut self, id: TaskId, at: NaiveDateTime) -> Result<(), TaskError> {
        sqlx::query(
            "INSERT INTO spawned_waits (task_id, last_check_at) VALUES (?, ?)
             ON CONFLICT (task_id) DO UPDATE SET last_check_at = excluded.last_check_at",
        )
        .bind(id.0)
        .bind(instant_column(at))
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }
}

/// A stored Expectation's next check, as the window its virtual check task is drawn in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExpectationCheck {
    /// The Expectation being checked on.
    pub expectation_id: i64,
    /// The day the check is due.
    pub due: TimeScope,
}

/// A Task's spawned wait as the views draw it: the overlay, plus what the template makes of it —
/// its Time Scope (the template's rule, counted from the day it began) and its next check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpawnedWaitView {
    /// The overlay itself.
    #[serde(flatten)]
    pub wait: SpawnedWait,
    /// Its Time Scope, when the template gives it a rule.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_scope: Option<TimeScope>,
    /// The day its next check is due, while it is pending, live and checked on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_check: Option<TimeScope>,
}

/// Every wait's derived windows at one load: the stored Expectations' next checks, and each
/// spawned wait with its window and next check. Mints the scope rows the windows land on.
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
    let mut windows = WaitWindows::default();
    for expectation in db.expectations().list().await? {
        if let Some(due) = stored_check_due(&expectation).filter(|due| is_due(*due, now)) {
            windows.expectation_checks.push(ExpectationCheck {
                expectation_id: expectation.id,
                due: check_window(db, due).await?,
            });
        }
    }
    for wait in db.tasks().spawned_waits().await? {
        let Some(template) = db.tasks().async_template(TaskId(wait.task_id)).await? else {
            continue;
        };
        let time_scope = match (&template.time_scope, wait.spawned_at) {
            (Some(rule), Some(began)) => window_from_rule(db, rule, day_of(began)).await?,
            _ => None,
        };
        let due = template
            .check_every
            .as_ref()
            .and_then(|every| spawned_check_due(&wait, every, now))
            .filter(|due| is_due(*due, now));
        let next_check = match due {
            Some(due) => Some(check_window(db, due).await?),
            None => None,
        };
        windows.spawned_waits.push(SpawnedWaitView {
            wait,
            time_scope,
            next_check,
        });
    }
    Ok(windows)
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
    let due = db
        .tasks()
        .async_template(task)
        .await?
        .and_then(|template| template.check_every)
        .and_then(|every| spawned_check_due(&wait, &every, at));
    if !due.is_some_and(|due| is_due(due, at)) {
        return Err(TaskError::NoCheckDue);
    }
    db.tasks().set_spawned_check(task, at).await
}

#[cfg(test)]
mod tests;
