//! Writes to a wait's derived rows: its check tasks and a Task's spawned wait.
//!
//! A **check task** takes an ordinary Task update, which lands on that one check. Its status is
//! the check itself: marking it done records the check (the next one then falls due one interval
//! later), and taking a done one back reopens it — the latest only, since the checks after it
//! stand. While open it can be In Progress, and it carries its own title, Plan, flags, tags and
//! block reasons in its overlay. What it cannot do is leave its wait, change its day, or be handed
//! to someone: each is refused out loud.
//!
//! A **spawned wait** takes its status and archive, which is all its overlay (`spawned_waits`)
//! holds; its title, tags, window and Check every are the Task's Expectation template's, and an
//! edit to them is refused with a pointer there. A **delegation wait** is released only by its
//! Task being done, so every write to one is refused.

use chrono::NaiveDateTime;

use super::{
    key::{CheckKey, DerivedKey},
    overlay::TaskOverlay,
};
use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    flows::error::FlowError,
    tasks::{
        model::{
            Expectation, ExpectationId, Task, TaskArchival, TaskId, TaskStatus,
            UpdateExpectationRequest, UpdateSpawnedWaitRequest, UpdateTaskRequest,
        },
        waits::{self, WaitKind},
    },
};

fn refused(message: &str) -> AppError {
    FlowError::Refused(message.to_string()).into()
}

/// The derived row `key` names as it reads now, if it is derived.
pub async fn check_row(
    db: &mut Db<Transactional>,
    key: &CheckKey,
    now: NaiveDateTime,
) -> Result<Task, AppError> {
    let id = DerivedKey::Check(*key).node_id();
    let tasks = db.tasks().list().await?;
    super::waits::derive_waits(db, now, &tasks)
        .await?
        .tasks
        .into_iter()
        .find(|task| task.id == id)
        .ok_or_else(|| FlowError::NodeNotFound(id.to_string()).into())
}

/// The spawned or delegation wait `key` names as it reads now.
pub async fn wait_row(
    db: &mut Db<Transactional>,
    key: &DerivedKey,
    now: NaiveDateTime,
) -> Result<Expectation, AppError> {
    let id = key.node_id();
    let mut tasks = db.tasks().list().await?;
    let flows = db.flows().list().await?;
    let (derived, _) = super::table::derive_habits(
        db,
        &flows,
        now,
        crate::flows::occurrences::Horizon::default(),
    )
    .await;
    tasks.extend(derived.tasks);
    super::waits::derive_waits(db, now, &tasks)
        .await?
        .expectations
        .into_iter()
        .find(|expectation| expectation.id == id)
        .ok_or_else(|| FlowError::NodeNotFound(id.to_string()).into())
}

/// What a check task reads when it says nothing of its own: its wait's title.
async fn wait_title(db: &mut Db<Transactional>, key: &CheckKey) -> Result<String, AppError> {
    Ok(match key.wait_kind {
        WaitKind::Stored => {
            db.expectations()
                .get(ExpectationId(key.wait_id))
                .await?
                .title
        }
        WaitKind::Spawned => db
            .tasks()
            .async_template(TaskId(key.wait_id))
            .await?
            .map(|template| template.title)
            .unwrap_or_default(),
    })
}

/// Refuses what a check task cannot take: a new parent, a new day, a delegate, or a wait of its
/// own to spawn. A request repeating the current parent and window — a full editor save — passes.
fn refuse_changes(current: &Task, request: &UpdateTaskRequest) -> Result<(), AppError> {
    let moves = match (&request.parent_type, &request.parent_id) {
        (None, None) => false,
        (Some(parent_type), Some(parent_id)) => {
            *parent_type != current.parent_type || *parent_id != current.parent_id
        }
        _ => true,
    };
    if moves {
        return Err(refused(
            "a check task belongs to its wait and cannot be moved",
        ));
    }
    let bounds = |scope: &Option<crate::tasks::model::TimeScope>| {
        scope.as_ref().map(|scope| (scope.start_id, scope.end_id))
    };
    if request
        .time_scope
        .as_ref()
        .is_some_and(|wanted| bounds(wanted) != bounds(&current.time_scope))
    {
        return Err(refused("a check task's day is when its check fell due"));
    }
    if matches!(request.delegate_to, Some(Some(_))) {
        return Err(refused(
            "a check on a wait is yours to make, and cannot be delegated",
        ));
    }
    if request.asynchronous == Some(true) || matches!(request.async_template, Some(Some(_))) {
        return Err(refused("a check task does not start a wait of its own"));
    }
    Ok(())
}

/// Applies an ordinary Task update to one check task.
#[tracing::instrument(skip(db, request))]
pub async fn update_check_task(
    db: &mut Db<Transactional>,
    key: &CheckKey,
    request: UpdateTaskRequest,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let current = check_row(db, key, now).await?;
    refuse_changes(&current, &request)?;
    let mut overlay = db.overlays().check_task(key).await?;
    if let Some(status) = request.status {
        set_status(db, key, &current, &mut overlay, status, now).await?;
    }
    if let Some(title) = request.title {
        overlay.title = (title != wait_title(db, key).await?).then_some(title);
    }
    if let Some(plan) = request.plan {
        overlay.plan_set = plan.is_some();
        (overlay.plan_start_id, overlay.plan_end_id) = match plan {
            Some(plan) => (Some(plan.start_id), Some(plan.end_id)),
            None => (None, None),
        };
    }
    if let Some(agentic) = request.agentic {
        overlay.agentic = agentic.as_column();
        overlay.agentic_set = overlay.agentic.is_some();
    }
    if let Some(archival) = request.archival {
        overlay.archival = (archival != TaskArchival::Live).then(|| archival.as_str().to_string());
    }
    if let Some(is_private) = request.is_private {
        overlay.is_private = (is_private != current.is_private || overlay.is_private.is_some())
            .then_some(is_private);
    }
    if let Some(position) = request.position {
        overlay.position = Some(position);
    }
    db.overlays().put_check_task(key, &overlay).await?;
    Ok(())
}

/// A check task's status is the check: done records it, and taking a done one back reopens it.
async fn set_status(
    db: &mut Db<Transactional>,
    key: &CheckKey,
    current: &Task,
    overlay: &mut TaskOverlay,
    status: TaskStatus,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let was_done = current.status == TaskStatus::Done.as_str();
    match status {
        TaskStatus::Done => {
            if !was_done {
                db.tasks()
                    .record_check(key.wait_kind, key.wait_id, key.due_at, now)
                    .await?;
            }
            overlay.status = None;
        }
        TaskStatus::Todo | TaskStatus::InProgress => {
            if was_done {
                waits::reopen_latest(db, key.wait_kind, key.wait_id, key.due_at).await?;
            }
            overlay.status =
                (status == TaskStatus::InProgress).then(|| status.as_str().to_string());
        }
    }
    Ok(())
}

/// Updates a spawned wait's status or archive; anything else is its Task's template's to say.
#[tracing::instrument(skip(db, request))]
pub async fn update_spawned_wait(
    db: &mut Db<Transactional>,
    task_id: i64,
    request: UpdateExpectationRequest,
    now: NaiveDateTime,
) -> Result<Expectation, AppError> {
    let key = DerivedKey::SpawnedWait(task_id);
    let current = wait_row(db, &key, now).await?;
    let changes_template = request
        .title
        .as_ref()
        .is_some_and(|title| *title != current.title)
        || request
            .check_every
            .as_ref()
            .is_some_and(|every| *every != current.check_every)
        || request
            .time_scope
            .as_ref()
            .is_some_and(|scope| *scope != current.time_scope)
        || request
            .parent_id
            .as_ref()
            .is_some_and(|parent| *parent != current.parent_id);
    if changes_template {
        return Err(refused(
            "a spawned wait is drawn from its Task's Expectation template — edit it there",
        ));
    }
    waits::update_spawned_wait(
        db,
        TaskId(task_id),
        UpdateSpawnedWaitRequest {
            status: request.status,
            archival: request.archival,
        },
    )
    .await?;
    wait_row(db, &key, now).await
}

/// Refuses a write to a delegated Task's wait: only the Task being done releases it.
pub fn refuse_delegation_wait() -> AppError {
    refused("a delegated Task's wait is released by the Task being done")
}

#[cfg(test)]
mod tests;
