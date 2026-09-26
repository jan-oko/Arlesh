//! Writes to a wait's derived rows: its check tasks and a Task's spawned wait.
//!
//! A **check task** takes an ordinary Task update, which lands on that one check. Its status is
//! the check itself: marking it done records the check (the next one then falls due one interval
//! later), and taking a done one back reopens it — the latest only, since the checks after it
//! stand. While open it can be In Progress, and it carries its own title, Plan, flags, tags and
//! block reasons in its overlay. What it cannot do is leave its wait, change its day, or be handed
//! to someone: each is refused out loud.
//!
//! A **spawned wait** and a **delegation wait** are ordinary Expectation rows, and take an
//! ordinary Expectation update: title, window, Check every and its Starting, privacy, the agentic
//! flag, note and answer land in the wait's Expectation overlay (`expectation_overlays`, see
//! [`super::wait_overlay`]), its tags as differences in `derived_tags` — that one wait only, the
//! template it is drawn from staying as it is for every other. A spawned wait's status and archive
//! are its own state (`spawned_waits`). What differs is what its origin fixes: neither leaves its
//! Task (a move is refused), and a delegation wait is released only by its Task being done, so it
//! takes no status of its own — and has no checks to schedule, so no Check every either.

use chrono::NaiveDateTime;

use super::{
    id::NodeId,
    key::{CheckKey, DerivedKey},
    overlay::TaskOverlay,
    wait_overlay::{ExpectationOverlay, WaitHome},
};
use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    flows::error::FlowError,
    tasks::{
        model::{
            Expectation, ExpectationId, ExpectationStatus, Task, TaskArchival, TaskId, TaskStatus,
            UpdateExpectationRequest, UpdateSpawnedWaitRequest, UpdateTaskRequest,
        },
        waits::{self, WaitRef},
    },
};

fn refused(message: &str) -> AppError {
    FlowError::Refused(message.to_string()).into()
}

/// Every wait's derived rows as they read now: the waits hang on the Task table, stored and
/// derived, so the Habits are derived first.
async fn wait_rows(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
) -> Result<super::waits::WaitRows, AppError> {
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
    super::waits::derive_waits(db, now, &tasks).await
}

/// The check task `key` names as it reads now.
pub async fn check_row(
    db: &mut Db<Transactional>,
    key: &CheckKey,
    now: NaiveDateTime,
) -> Result<Task, AppError> {
    let id = DerivedKey::Check(key.clone()).node_id();
    wait_rows(db, now)
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
    Ok(drawn_and_read(db, key, now).await?.1)
}

/// The spawned or delegation wait `key` names as it is drawn — from its template, or its Task —
/// and as it reads now, with what was written to it.
async fn drawn_and_read(
    db: &mut Db<Transactional>,
    key: &DerivedKey,
    now: NaiveDateTime,
) -> Result<(Expectation, Expectation), AppError> {
    let id = key.node_id();
    let mut rows = wait_rows(db, now).await?;
    let read = rows
        .expectations
        .into_iter()
        .find(|expectation| expectation.id == id);
    match (rows.drawn.remove(&id), read) {
        (Some(drawn), Some(read)) => Ok((drawn, read)),
        _ => Err(FlowError::NodeNotFound(id.to_string()).into()),
    }
}

/// What a check task reads when it says nothing of its own: its wait's title.
async fn wait_title(
    db: &mut Db<Transactional>,
    key: &CheckKey,
    now: NaiveDateTime,
) -> Result<String, AppError> {
    let spawned_by = match &key.wait {
        WaitRef::Stored(id) => return Ok(db.expectations().get(ExpectationId(*id)).await?.title),
        WaitRef::Spawned(task) => NodeId::Stored(*task),
        WaitRef::Occurrence(node_key) => NodeId::Derived(super::id::DerivedId::of_key(node_key)),
    };
    Ok(wait_row(db, &DerivedKey::SpawnedWait(spawned_by), now)
        .await?
        .title)
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
        overlay.title = (title != wait_title(db, key, now).await?).then_some(title);
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
                db.tasks().record_check(&key.wait, key.due_at, now).await?;
            }
            overlay.status = None;
        }
        TaskStatus::Todo | TaskStatus::InProgress => {
            if was_done {
                waits::reopen_latest(db, &key.wait, key.due_at).await?;
            }
            overlay.status =
                (status == TaskStatus::InProgress).then(|| status.as_str().to_string());
        }
    }
    Ok(())
}

/// Updates a spawned wait — the one Asynchronous `task_id` spawned — as any Expectation is
/// updated: its status and archive into its own state, everything else into its overlay. It cannot
/// leave its Task.
#[tracing::instrument(skip(db, request))]
pub async fn update_spawned_wait(
    db: &mut Db<Transactional>,
    task_id: &NodeId,
    request: UpdateExpectationRequest,
    now: NaiveDateTime,
) -> Result<Expectation, AppError> {
    let key = DerivedKey::SpawnedWait(task_id.clone());
    let (drawn, current) = drawn_and_read(db, &key, now).await?;
    refuse_move(
        &current,
        &request,
        "a spawned wait belongs to the Task that spawned it",
    )?;
    let home = wait_home(db, task_id, now).await?;
    write_overlay(db, &key, &home, &drawn, &current, &request, now).await?;
    if request.status.is_some() || request.archival.is_some() {
        write_spawned_state(db, task_id, &home, &current, &request).await?;
    }
    wait_row(db, &key, now).await
}

/// Updates a delegated Task's wait as any Expectation is updated, into its overlay — all but its
/// status, which only the Task being done releases, and a Check every, since nothing schedules
/// checks on it. It cannot leave its Task.
#[tracing::instrument(skip(db, request))]
pub async fn update_delegation_wait(
    db: &mut Db<Transactional>,
    task_id: &NodeId,
    mut request: UpdateExpectationRequest,
    now: NaiveDateTime,
) -> Result<Expectation, AppError> {
    let key = DerivedKey::DelegationWait(task_id.clone());
    let (drawn, current) = drawn_and_read(db, &key, now).await?;
    refuse_move(
        &current,
        &request,
        "a delegated Task's wait belongs to its Task",
    )?;
    if request
        .status
        .is_some_and(|status| status != current.status)
    {
        return Err(refuse_delegation_wait());
    }
    if request
        .check_every
        .as_ref()
        .is_some_and(|every| *every != current.check_every)
    {
        return Err(refused(
            "a delegated Task's wait has no checks — it is over when the Task is done",
        ));
    }
    request.check_starting = None;
    let home = wait_home(db, task_id, now).await?;
    let mut overlay = db.overlays().expectation(&key.node_key()).await?;
    if let Some(archival) = request.archival {
        overlay.set_archival(archival, &drawn);
    }
    db.overlays()
        .put_expectation(&key.node_key(), &home, &overlay)
        .await?;
    write_overlay(db, &key, &home, &drawn, &current, &request, now).await?;
    wait_row(db, &key, now).await
}

/// Puts a tag on (`present`) or takes one off a spawned or delegation wait: that wait only, as a
/// difference against the tags it is drawn with.
#[tracing::instrument(skip(db))]
pub async fn set_wait_tag(
    db: &mut Db<Transactional>,
    key: &DerivedKey,
    tag_id: i64,
    present: bool,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let task_id = match key {
        DerivedKey::SpawnedWait(task) | DerivedKey::DelegationWait(task) => task,
        _ => return Err(refused("only a wait takes an Expectation's tags")),
    };
    let (drawn, _) = drawn_and_read(db, key, now).await?;
    let home = wait_home(db, task_id, now).await?;
    db.relations()
        .set_tag(
            home.flow_id,
            "expectation",
            &key.node_key(),
            tag_id,
            drawn.tag_ids.contains(&tag_id),
            present,
        )
        .await?;
    Ok(())
}

/// Refuses a request that would move a derived wait off its Task. One naming its current parent
/// — a full editor save — is not a move.
fn refuse_move(
    current: &Expectation,
    request: &UpdateExpectationRequest,
    message: &str,
) -> Result<(), AppError> {
    let moves = request
        .parent_id
        .as_ref()
        .is_some_and(|parent| *parent != current.parent_id)
        || request
            .parent_type
            .as_ref()
            .is_some_and(|parent_type| *parent_type != current.parent_type);
    if moves {
        return Err(refused(message));
    }
    Ok(())
}

/// Where a wait under `task_id` keeps its overlay: with the Habit and occurrence, when its Task is
/// one.
async fn wait_home(
    db: &mut Db<Transactional>,
    task_id: &NodeId,
    now: NaiveDateTime,
) -> Result<WaitHome, AppError> {
    let NodeId::Derived(derived) = task_id else {
        return Ok(WaitHome::default());
    };
    let DerivedKey::Occurrence(occurrence) = super::table::resolve_key(db, derived, now).await?
    else {
        return Err(refused("only a Task has a wait"));
    };
    Ok(WaitHome {
        flow_id: Some(db.flows().occurrence_flow_id(&occurrence).await?.0),
        occurrence_key: Some(occurrence.node_key()),
    })
}

/// Writes every field of `request` but status and archive into the wait's overlay, each as an
/// override of what it is drawn with — so a value set back to that clears the override.
async fn write_overlay(
    db: &mut Db<Transactional>,
    key: &DerivedKey,
    home: &WaitHome,
    drawn: &Expectation,
    current: &Expectation,
    request: &UpdateExpectationRequest,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let node_key = key.node_key();
    let mut overlay = db.overlays().expectation(&node_key).await?;
    if let Some(title) = &request.title {
        overlay.set_title(title.clone(), drawn);
    }
    if let Some(scope) = &request.time_scope {
        overlay.set_time_scope(scope.clone(), drawn);
    }
    if let Some(every) = &request.check_every {
        overlay.set_check_every(every.clone(), drawn);
    }
    if let Some(starting) = request.check_starting {
        set_starting(&mut overlay, starting, drawn, current);
    }
    if let Some(is_private) = request.is_private {
        overlay.set_is_private(is_private, drawn);
    }
    if let Some(agentic) = request.agentic {
        if agentic && !current.agentic {
            require_agentic_task(db, &current.parent_id, now).await?;
        }
        overlay.set_agentic(agentic, drawn);
    }
    if let Some(note) = &request.agentic_note {
        overlay.set_agentic_note(note.clone(), drawn);
    }
    if let Some(question) = request.question {
        overlay.set_question(question, drawn);
    }
    if let Some(answer) = &request.answer {
        overlay.set_answer(answer.clone(), drawn);
    }
    refuse_unanswered_release(&overlay, drawn, current, request)?;
    db.overlays()
        .put_expectation(&node_key, home, &overlay)
        .await?;
    Ok(())
}

/// A Starting the editor repeats — the day it showed — changes nothing; another day is the wait's
/// own, unless it is the day it is drawn with.
fn set_starting(
    overlay: &mut ExpectationOverlay,
    starting: NaiveDateTime,
    drawn: &Expectation,
    current: &Expectation,
) {
    let shown = current
        .check_starting
        .is_some_and(|shown| shown.date() == starting.date());
    if !shown {
        overlay.set_check_starting(starting, drawn);
    }
}

/// Refuses releasing a question wait with no answer, as a stored wait's release is refused.
fn refuse_unanswered_release(
    overlay: &ExpectationOverlay,
    drawn: &Expectation,
    current: &Expectation,
    request: &UpdateExpectationRequest,
) -> Result<(), AppError> {
    let releases = request.status == Some(ExpectationStatus::Released)
        && current.status != ExpectationStatus::Released;
    let mut after = drawn.clone();
    overlay.apply(&mut after);
    let answered = after
        .answer
        .as_deref()
        .is_some_and(|answer| !answer.trim().is_empty());
    if releases && after.agentic && after.question && !answered {
        return Err(crate::tasks::error::TaskError::AgenticAnswerMissing.into());
    }
    Ok(())
}

/// Refuses making a wait agentic unless the Task it hangs under reads as Agentic.
async fn require_agentic_task(
    db: &mut Db<Transactional>,
    task_id: &NodeId,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let agentic = match task_id {
        NodeId::Stored(task) => {
            crate::tasks::agentic::require_agentic_parent(db, "task", *task).await?;
            return Ok(());
        }
        NodeId::Derived(derived) => match super::table::resolve_key(db, derived, now).await? {
            DerivedKey::Occurrence(occurrence) => {
                crate::tasks::agentic::occurrence_reads_agentic(db, &occurrence).await?
            }
            _ => false,
        },
    };
    if agentic {
        return Ok(());
    }
    Err(crate::tasks::error::TaskError::AgenticWaitOutsideAgenticTask.into())
}

/// Writes a spawned wait's status and archive: its own state, kept beside its Task.
async fn write_spawned_state(
    db: &mut Db<Transactional>,
    task_id: &NodeId,
    home: &WaitHome,
    current: &Expectation,
    request: &UpdateExpectationRequest,
) -> Result<(), AppError> {
    match (task_id, &home.occurrence_key, home.flow_id) {
        (NodeId::Stored(task), _, _) => {
            waits::update_spawned_wait(
                db,
                TaskId(*task),
                UpdateSpawnedWaitRequest {
                    status: request.status,
                    archival: request.archival,
                },
            )
            .await?;
        }
        (_, Some(occurrence_key), Some(flow_id)) => {
            db.overlays()
                .put_spawned_wait_state(
                    flow_id,
                    occurrence_key,
                    request.status.unwrap_or(current.status),
                    request.archival.unwrap_or(current.archival),
                )
                .await?;
        }
        _ => return Err(refused("only a Task spawns a wait")),
    }
    Ok(())
}

/// Refuses a write to a delegated Task's wait: only the Task being done releases it.
pub fn refuse_delegation_wait() -> AppError {
    refused("a delegated Task's wait is released by the Task being done")
}

#[cfg(test)]
mod tests;
