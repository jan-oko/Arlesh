//! A wait's derived rows: its check tasks, a Task's spawned wait, and a delegated Task's wait.
//!
//! Each is an ordinary row of its kind (ADR 0008), with a UUID id and an `origin` saying what it
//! is drawn from:
//!
//! - a **check task** is a Task beneath a wait — one per check made, done, and the one due now,
//!   open. What it is drawn from is the wait and when the check fell due; what one check task
//!   changes (its status while open, its title, Plan, flags, tags, block reasons) lives in
//!   `task_overlays` under its own key, as a Habit occurrence's does;
//! - a **spawned wait** is the Expectation an Asynchronous Task's completion spawned, drawn from
//!   the Task's Expectation template, its state in `spawned_waits`;
//! - a **delegation wait** is the Expectation a delegated Task waits on while it is not done.
//!
//! When checks fall due, and what they were, is `crate::tasks::waits`; this turns that into rows.

use std::collections::HashMap;

use chrono::NaiveDateTime;

use super::{
    id::{DerivedId, NodeId},
    key::{CheckKey, DerivedKey, OccurrenceKey, TemplateItem},
    origin::{CheckOrigin, Origin, WaitOrigin},
    overlay::TaskOverlay,
    registry,
};
use crate::{
    block_reasons::model::BlockReason,
    database::session::{Db, SessionMode},
    error::AppError,
    tasks::{
        expectations::EXPECTATION,
        lifecycle::ItemLifecycle,
        model::{
            Expectation, ExpectationArchival, ExpectationStatus, Task, TaskArchival, TaskId,
            TimeScope,
        },
        wait_lifecycle,
        waits::{self, WaitProgress, WaitRef},
    },
};

/// Every wait's derived rows at one load.
#[derive(Debug, Default)]
pub struct WaitRows {
    /// The check tasks.
    pub tasks: Vec<Task>,
    /// The spawned waits and the delegation waits.
    pub expectations: Vec<Expectation>,
    /// The check tasks' own block reasons.
    pub block_reasons: Vec<BlockReason>,
    /// The lifecycles of the waits Habit occurrences spawned, and of their open checks. (A stored
    /// wait's, and a stored Task's spawned wait's, come with every other stored row's.)
    pub lifecycles: Vec<ItemLifecycle>,
}

/// What a check task's row is read from besides its key: every check task's overlay, tags and
/// block reasons, read once for the whole load.
struct CheckState {
    overlays: HashMap<String, TaskOverlay>,
    tags: super::relations::TagDifferences,
    reasons: HashMap<String, Vec<String>>,
}

/// One check to draw: which, where, and the wait it is on.
struct CheckDraw<'wait> {
    key: CheckKey,
    wait_title: &'wait str,
    wait_row: NodeId,
    due: TimeScope,
    done: bool,
    is_private: bool,
}

/// Derives every wait's rows at `now`. `tasks` is the Task table the waits hang on — stored and
/// derived — which is what says which Tasks are delegated.
pub async fn derive_waits<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
    tasks: &[Task],
) -> Result<WaitRows, AppError> {
    let windows = waits::derive_wait_windows(db, now).await?;
    let state = CheckState {
        overlays: db.overlays().check_tasks().await?,
        tags: db.relations().tags_without_habit().await?,
        reasons: db.relations().block_reasons_without_habit().await?,
    };
    let stored: HashMap<i64, Expectation> = db
        .expectations()
        .list()
        .await?
        .into_iter()
        .filter_map(|expectation| Some((expectation.id.stored()?, expectation)))
        .collect();
    let mut rows = WaitRows::default();
    for check in &windows.expectation_checks {
        let Some(wait) = stored.get(&check.expectation_id) else {
            continue;
        };
        rows.push_check(
            &state,
            CheckDraw {
                key: CheckKey {
                    wait: WaitRef::Stored(check.expectation_id),
                    due_at: check.due_at,
                },
                wait_title: &wait.title,
                wait_row: wait.id.clone(),
                due: check.due.clone(),
                done: check.resolved_at.is_some(),
                is_private: wait.is_private,
            },
        );
    }
    let by_id: HashMap<&NodeId, &Task> = tasks.iter().map(|task| (&task.id, task)).collect();
    for spawned in windows.spawned_waits {
        let task_id = spawned.wait.task_id;
        let Some(task) = by_id.get(&NodeId::Stored(task_id)) else {
            continue;
        };
        let Some(template) = db.tasks().async_template(TaskId(task_id)).await? else {
            continue;
        };
        let wait_row = NodeId::Derived(registry::remember(&DerivedKey::SpawnedWait(
            NodeId::Stored(task_id),
        )));
        let draw = |due_at: NaiveDateTime, due: TimeScope, done: bool| CheckDraw {
            key: CheckKey {
                wait: WaitRef::Spawned(task_id),
                due_at,
            },
            wait_title: &template.title,
            wait_row: wait_row.clone(),
            due,
            done,
            is_private: task.is_private,
        };
        for done in &spawned.done_checks {
            rows.push_check(&state, draw(done.due_at, done.due.clone(), true));
        }
        if let (Some(due), Some(due_at)) = (&spawned.next_check, spawned.next_check_at) {
            rows.push_check(&state, draw(due_at, due.clone(), false));
        }
        rows.expectations.push(Expectation {
            id: wait_row.clone(),
            title: template.title.clone(),
            parent_type: "task".to_string(),
            parent_id: NodeId::Stored(task_id),
            status: spawned.wait.status,
            archival: spawned.wait.archival,
            time_scope: spawned.time_scope.clone(),
            tag_ids: template.tag_ids.clone(),
            check_every: template.check_every.clone(),
            check_starting: spawned.wait.spawned_at,
            last_check_at: spawned.wait.last_check_at,
            position: i64::MIN,
            is_private: task.is_private,
            origin: Origin::SpawnedWait(WaitOrigin {
                task_id: NodeId::Stored(task_id),
            }),
        });
    }
    for task in tasks.iter().filter(|task| task.origin.habit().is_some()) {
        rows.push_occurrence_wait(db, &state, task, now).await?;
    }
    for task in tasks
        .iter()
        .filter(|task| task.delegate_to.is_some() && task.status != "done")
    {
        rows.expectations.push(delegation_wait(task));
    }
    Ok(rows)
}

/// The occurrence a Habit origin names.
pub(crate) fn occurrence_key(habit: &super::origin::HabitOrigin) -> OccurrenceKey {
    OccurrenceKey {
        item: TemplateItem {
            item_type: habit.item_type,
            item_id: habit.item_id,
        },
        iteration: habit.iteration_scope.scope_id,
        cycle: habit.cycle_id,
    }
}

/// The wait a delegated Task has on its delegate: pending, live, no window, no check. Its title
/// is the Task's; the views say what it is waiting on.
fn delegation_wait(task: &Task) -> Expectation {
    let key = DerivedKey::DelegationWait(task.id.clone());
    Expectation {
        id: NodeId::Derived(registry::remember(&key)),
        title: task.title.clone(),
        parent_type: "task".to_string(),
        parent_id: task.id.clone(),
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        time_scope: None,
        tag_ids: Vec::new(),
        check_every: None,
        check_starting: None,
        last_check_at: None,
        position: i64::MIN,
        is_private: task.is_private,
        origin: Origin::DelegationWait(WaitOrigin {
            task_id: task.id.clone(),
        }),
    }
}

impl WaitRows {
    /// Draws the wait a done, Asynchronous Habit occurrence spawned from its own Expectation
    /// template, and that wait's checks — exactly as a stored Task's, keyed by the occurrence.
    async fn push_occurrence_wait<M: SessionMode>(
        &mut self,
        db: &mut Db<M>,
        state: &CheckState,
        task: &Task,
        now: NaiveDateTime,
    ) -> Result<(), AppError> {
        let Some(template) = task.async_template.as_ref() else {
            return Ok(());
        };
        let Some(habit) = task.origin.habit() else {
            return Ok(());
        };
        if !task.asynchronous || task.status != "done" {
            return Ok(());
        }
        let key = occurrence_key(habit);
        let node_key = key.node_key();
        let spawned_at = db
            .overlays()
            .task(&key)
            .await?
            .resolved_at
            .and_then(chrono::DateTime::from_timestamp_millis)
            .map(|at| at.naive_utc());
        let (status, archival) = db.overlays().spawned_wait_state(&node_key).await?;
        let wait = WaitRef::Occurrence(node_key);
        // A check made during an earlier completion belongs to that one, not this.
        let checks: Vec<_> = db
            .tasks()
            .wait_checks(&wait)
            .await?
            .into_iter()
            .filter(|check| spawned_at.is_none_or(|began| check.resolved_at >= began))
            .collect();
        let progress = WaitProgress {
            spawned_at,
            status,
            archival,
            last_check_at: checks.last().map(|check| check.resolved_at),
        };
        let wait_row = NodeId::Derived(registry::remember(&DerivedKey::SpawnedWait(
            task.id.clone(),
        )));
        let time_scope = match (&template.time_scope, spawned_at) {
            (Some(rule), Some(began)) => waits::window_from_rule(rule, waits::day_of(began))?,
            _ => None,
        };
        let draw = |due_at: NaiveDateTime, done: bool| CheckDraw {
            key: CheckKey {
                wait: wait.clone(),
                due_at,
            },
            wait_title: &template.title,
            wait_row: wait_row.clone(),
            due: waits::check_window(due_at),
            done,
            is_private: task.is_private,
        };
        for check in &checks {
            self.push_check(state, draw(check.due_at, true));
        }
        let due = template
            .check_every
            .as_ref()
            .and_then(|every| waits::next_spawned_check(&progress, every, now))
            .filter(|due| waits::is_due(*due, now));
        if let Some(due_at) = due {
            let open = draw(due_at, false);
            self.lifecycles.push(wait_lifecycle(
                "task",
                DerivedKey::Check(open.key.clone()).node_id(),
                Some(&open.due),
                status,
                archival,
                now,
            ));
            self.push_check(state, open);
        }
        self.lifecycles.push(wait_lifecycle(
            EXPECTATION,
            wait_row.clone(),
            time_scope.as_ref(),
            status,
            archival,
            now,
        ));
        self.expectations.push(Expectation {
            id: wait_row,
            title: template.title.clone(),
            parent_type: "task".to_string(),
            parent_id: task.id.clone(),
            status,
            archival,
            time_scope,
            tag_ids: template.tag_ids.clone(),
            check_every: template.check_every.clone(),
            check_starting: spawned_at,
            last_check_at: progress.last_check_at,
            position: i64::MIN,
            is_private: task.is_private,
            origin: Origin::SpawnedWait(WaitOrigin {
                task_id: task.id.clone(),
            }),
        });
        Ok(())
    }

    /// Draws one check task, overlaid with what it has had done to it.
    fn push_check(&mut self, state: &CheckState, draw: CheckDraw<'_>) {
        let node_key = draw.key.node_key();
        let origin = Origin::Check(CheckOrigin {
            wait_kind: draw.key.wait.kind(),
            wait_id: match &draw.key.wait {
                WaitRef::Stored(id) | WaitRef::Spawned(id) => NodeId::Stored(*id),
                WaitRef::Occurrence(key) => NodeId::Derived(DerivedId::of_key(key)),
            },
            due_at: draw.key.due_at,
        });
        let id = NodeId::Derived(registry::remember(&DerivedKey::Check(draw.key)));
        let overlay = state.overlays.get(&node_key).cloned().unwrap_or_default();
        let status = if draw.done {
            "done".to_string()
        } else {
            overlay.status.clone().unwrap_or_else(|| "todo".to_string())
        };
        let plan = overlay
            .plan_start_id
            .zip(overlay.plan_end_id)
            .map(|(start_id, end_id)| TimeScope {
                start_id,
                end_id,
                duration: None,
            });
        let tag_ids = state
            .tags
            .get(&node_key)
            .map(|differences| {
                differences
                    .iter()
                    .filter(|(_, added)| *added)
                    .map(|(tag, _)| *tag)
                    .collect()
            })
            .unwrap_or_default();
        if overlay.block_reasons_set {
            let reasons = state.reasons.get(&node_key).cloned().unwrap_or_default();
            for (position, reason) in reasons.into_iter().enumerate() {
                self.block_reasons.push(BlockReason {
                    owner_type: "task".to_string(),
                    owner_id: id.clone(),
                    reason,
                    position: i64::try_from(position).unwrap_or(i64::MAX),
                });
            }
        }
        self.tasks.push(Task {
            id,
            title: overlay
                .title
                .clone()
                .unwrap_or_else(|| draw.wait_title.to_string()),
            parent_type: "expectation".to_string(),
            parent_id: draw.wait_row,
            status,
            delegate_to: None,
            agentic: overlay.agentic,
            asynchronous: false,
            async_template: None,
            time_scope: Some(draw.due),
            on_scope_exit: None,
            plan,
            archival: overlay
                .archival
                .as_deref()
                .and_then(TaskArchival::from_db)
                .unwrap_or_default(),
            tag_ids,
            position: overlay.position.unwrap_or(i64::MIN),
            is_private: overlay.is_private.unwrap_or(draw.is_private),
            beads_id: None,
            origin,
        });
    }
}

#[cfg(test)]
mod tests;
