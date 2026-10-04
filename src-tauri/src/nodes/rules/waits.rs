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
//!
//! Pure: [`derive_waits_in`] draws them over [`WaitBoardSources`], which
//! [`crate::nodes::waits::derive_waits`] reads (ADR 0010).

use std::collections::HashMap;

use chrono::NaiveDateTime;

use crate::{
    block_reasons::model::BlockReason,
    error::AppError,
    nodes::{
        id::{DerivedId, NodeId},
        key::{CheckKey, DerivedKey, OccurrenceKey, TemplateItem},
        origin::{CheckOrigin, Origin, WaitOrigin},
        overlay::TaskOverlay,
        registry,
        relations::TagDifferences,
        wait_overlay::ExpectationOverlay,
    },
    tasks::{
        expectations::EXPECTATION,
        lifecycle::ItemLifecycle,
        model::{
            Expectation, ExpectationArchival, ExpectationStatus, Status, Task, TaskArchival,
            TaskStatus, TimeScope,
        },
        wait_lifecycle,
        waits::{self, WaitProgress, WaitRef, WaitSources},
    },
};

/// What a board's waits are drawn from: what their windows are derived from, every wait's and
/// check task's overlay, tags and block reasons, each Habit occurrence's Task overlay (when it
/// was done) and the state of the wait it spawned.
pub struct WaitBoardSources<'rows> {
    /// What the waits' windows are derived from.
    pub windows: WaitSources<'rows>,
    /// Every check task's overlay, tags and block reasons.
    pub(in crate::nodes) checks: &'rows CheckState,
    /// Every derived wait's overlay and tags.
    pub(in crate::nodes) waits: &'rows WaitState,
    /// Every Task overlay, by node key.
    pub task_overlays: &'rows HashMap<String, TaskOverlay>,
    /// The status and archive of every wait a Habit occurrence spawned, by the occurrence's key.
    pub spawned_states: &'rows HashMap<String, (ExpectationStatus, ExpectationArchival)>,
}

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
    /// Each spawned and delegation wait as it is **drawn** — from its Task's template, or its
    /// Task — before its own overlay: what a write compares against, so setting a field back to
    /// it clears the override.
    pub drawn: HashMap<NodeId, Expectation>,
}

/// What a derived wait's row is read from besides what draws it: every wait's overlay and tag
/// differences, read once for the whole load.
pub(in crate::nodes) struct WaitState {
    pub(in crate::nodes) overlays: HashMap<String, ExpectationOverlay>,
    pub(in crate::nodes) tags: TagDifferences,
}

impl WaitState {
    /// `drawn` with its own overlay and tags applied.
    fn read(&self, key: &DerivedKey, drawn: &Expectation) -> Expectation {
        let node_key = key.node_key();
        let mut row = drawn.clone();
        if let Some(overlay) = self.overlays.get(&node_key) {
            overlay.apply(&mut row);
        }
        row.tag_ids =
            crate::flows::occurrences::effective_tags(&drawn.tag_ids, self.tags.get(&node_key));
        row
    }

    fn overlay(&self, key: &DerivedKey) -> ExpectationOverlay {
        self.overlays
            .get(&key.node_key())
            .cloned()
            .unwrap_or_default()
    }
}

/// What a check task's row is read from besides its key: every check task's overlay, tags and
/// block reasons, read once for the whole load.
pub(in crate::nodes) struct CheckState {
    pub(in crate::nodes) overlays: HashMap<String, TaskOverlay>,
    pub(in crate::nodes) tags: TagDifferences,
    pub(in crate::nodes) reasons: HashMap<String, Vec<String>>,
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
/// derived — which is what says which Tasks are delegated. `waits` is the Expectation table: each
/// wait item occurrence among it is checked on here, as a stored wait is.
pub fn derive_waits_in(
    sources: &WaitBoardSources<'_>,
    now: NaiveDateTime,
    tasks: &[Task],
    waits: &[Expectation],
) -> Result<WaitRows, AppError> {
    let windows = waits::wait_windows(&sources.windows, now)?;
    let state = sources.checks;
    let stored: HashMap<i64, &Expectation> = sources
        .windows
        .expectations
        .iter()
        .filter_map(|expectation| Some((expectation.id.stored()?, expectation)))
        .collect();
    let wait_state = sources.waits;
    let mut rows = WaitRows::default();
    for check in &windows.expectation_checks {
        let Some(wait) = stored.get(&check.expectation_id) else {
            continue;
        };
        rows.push_check(
            state,
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
        // A compound Task is never done by hand, so nothing is done that starts a wait: it
        // spawns none while it consists of its sub-items. Switching compound off at Done
        // records the completion, and the wait begins then.
        if task.compound {
            continue;
        }
        let Some(template) = sources.windows.templates.get(&task_id) else {
            continue;
        };
        let key = DerivedKey::SpawnedWait(NodeId::Stored(task_id));
        let wait_row = NodeId::Derived(registry::remember(&key));
        // As drawn from the template alone, then as it reads with what was written to it.
        let spawned_at = spawned.wait.spawned_at;
        let drawn_schedule =
            waits::spawned_schedule(template, spawned_at, &ExpectationOverlay::default())?;
        let drawn_start = drawn_schedule.check_every.as_ref().and_then(|every| {
            waits::first_spawned_check(
                &WaitProgress {
                    check_starting: None,
                    ..WaitProgress::of(&spawned.wait)
                },
                every,
            )
        });
        let drawn = Expectation {
            id: wait_row.clone(),
            title: template.title.clone(),
            parent_type: "task".to_string(),
            parent_id: NodeId::Stored(task_id),
            status: spawned.wait.status,
            archival: spawned.wait.archival,
            time_scope: drawn_schedule.time_scope,
            tag_ids: template.tag_ids.clone(),
            check_every: drawn_schedule.check_every,
            check_starting: drawn_start,
            last_check_at: spawned.wait.last_check_at,
            position: i64::MIN,
            is_private: task.is_private,
            // A derived wait is not one an agent raised until it says so itself.
            agentic: false,
            agentic_note: None,
            question: false,
            answer: None,
            origin: Origin::SpawnedWait(WaitOrigin {
                task_id: NodeId::Stored(task_id),
            }),
        };
        let mut row = wait_state.read(&key, &drawn);
        // Its window and schedule are the ones its checks were drawn on.
        row.time_scope.clone_from(&spawned.time_scope);
        row.check_every.clone_from(&spawned.check_every);
        row.check_starting = spawned.check_starting;
        let draw = |due_at: NaiveDateTime, due: TimeScope, done: bool| CheckDraw {
            key: CheckKey {
                wait: WaitRef::Spawned(task_id),
                due_at,
            },
            wait_title: &row.title,
            wait_row: wait_row.clone(),
            due,
            done,
            is_private: row.is_private,
        };
        for done in &spawned.done_checks {
            rows.push_check(state, draw(done.due_at, done.due.clone(), true));
        }
        if let (Some(due), Some(due_at)) = (&spawned.next_check, spawned.next_check_at) {
            rows.push_check(state, draw(due_at, due.clone(), false));
        }
        rows.drawn.insert(wait_row, drawn);
        rows.expectations.push(row);
    }
    for task in tasks.iter().filter(|task| task.origin.habit().is_some()) {
        rows.push_occurrence_wait(sources, task, now)?;
    }
    for wait in waits.iter().filter(|wait| is_wait_item(wait)) {
        rows.push_item_checks(state, &sources.windows, wait, now);
    }
    for task in tasks
        .iter()
        .filter(|task| task.delegate_to.is_some() && !task.status.is_done())
    {
        let drawn = delegation_wait(task);
        let row = wait_state.read(&DerivedKey::DelegationWait(task.id.clone()), &drawn);
        rows.drawn.insert(drawn.id.clone(), drawn);
        rows.expectations.push(row);
    }
    Ok(rows)
}

/// Whether `wait` is an occurrence of a Flow's wait item.
fn is_wait_item(wait: &Expectation) -> bool {
    wait.origin
        .habit()
        .is_some_and(|habit| habit.item_type == crate::nodes::key::TemplateKind::FlowExpectation)
}

/// The occurrence a Habit origin names.
pub(crate) fn occurrence_key(habit: &crate::nodes::origin::HabitOrigin) -> OccurrenceKey {
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
        // A derived wait is not one an agent raised until it says so itself.
        agentic: false,
        agentic_note: None,
        question: false,
        answer: None,
        origin: Origin::DelegationWait(WaitOrigin {
            task_id: task.id.clone(),
        }),
    }
}

impl WaitRows {
    /// Draws the wait a done, Asynchronous Habit occurrence spawned from its own Expectation
    /// template, and that wait's checks — exactly as a stored Task's, keyed by the occurrence.
    fn push_occurrence_wait(
        &mut self,
        sources: &WaitBoardSources<'_>,
        task: &Task,
        now: NaiveDateTime,
    ) -> Result<(), AppError> {
        let state = sources.checks;
        let waits_state = sources.waits;
        let Some(template) = task.async_template.as_ref() else {
            return Ok(());
        };
        let Some(habit) = task.origin.habit() else {
            return Ok(());
        };
        // A compound occurrence is never done by hand, so it spawns no wait, as a compound Task
        // does not.
        if !task.asynchronous || !task.status.is_done() || task.compound {
            return Ok(());
        }
        let key = occurrence_key(habit);
        let node_key = key.node_key();
        let spawned_at = sources
            .task_overlays
            .get(&node_key)
            .and_then(|overlay| overlay.resolved_at)
            .and_then(chrono::DateTime::from_timestamp_millis)
            .map(|at| at.naive_utc());
        let (status, archival) = sources
            .spawned_states
            .get(&node_key)
            .copied()
            .unwrap_or_default();
        let wait = WaitRef::Occurrence(node_key);
        // A check made during an earlier completion belongs to that one, not this.
        let checks: Vec<_> = sources
            .windows
            .checks
            .get(&wait)
            .map_or(&[][..], Vec::as_slice)
            .iter()
            .copied()
            .filter(|check| spawned_at.is_none_or(|began| check.resolved_at >= began))
            .collect();
        let spawned_key = DerivedKey::SpawnedWait(task.id.clone());
        let overlay = waits_state.overlay(&spawned_key);
        let schedule = waits::spawned_schedule(template, spawned_at, &overlay)?;
        let drawn_schedule =
            waits::spawned_schedule(template, spawned_at, &ExpectationOverlay::default())?;
        let progress = WaitProgress {
            spawned_at,
            status,
            archival,
            last_check_at: checks.last().map(|check| check.resolved_at),
            check_starting: schedule.check_starting,
        };
        let wait_row = NodeId::Derived(registry::remember(&spawned_key));
        let drawn = Expectation {
            id: wait_row.clone(),
            title: template.title.clone(),
            parent_type: "task".to_string(),
            parent_id: task.id.clone(),
            status,
            archival,
            time_scope: drawn_schedule.time_scope,
            tag_ids: template.tag_ids.clone(),
            check_starting: drawn_schedule.check_every.as_ref().and_then(|every| {
                waits::first_spawned_check(
                    &WaitProgress {
                        check_starting: None,
                        ..progress
                    },
                    every,
                )
            }),
            check_every: drawn_schedule.check_every,
            last_check_at: progress.last_check_at,
            position: i64::MIN,
            is_private: task.is_private,
            // A derived wait is not one an agent raised until it says so itself.
            agentic: false,
            agentic_note: None,
            question: false,
            answer: None,
            origin: Origin::SpawnedWait(WaitOrigin {
                task_id: task.id.clone(),
            }),
        };
        let mut row = waits_state.read(&spawned_key, &drawn);
        // Its window and schedule are the ones its checks are drawn on.
        row.time_scope.clone_from(&schedule.time_scope);
        row.check_starting = schedule
            .check_every
            .as_ref()
            .and_then(|every| waits::first_spawned_check(&progress, every));
        row.check_every.clone_from(&schedule.check_every);
        let draw = |due_at: NaiveDateTime, done: bool| CheckDraw {
            key: CheckKey {
                wait: wait.clone(),
                due_at,
            },
            wait_title: &row.title,
            wait_row: wait_row.clone(),
            due: waits::check_window(due_at),
            done,
            is_private: row.is_private,
        };
        for check in &checks {
            self.push_check(state, draw(check.due_at, true));
        }
        let due = schedule
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
            row.time_scope.as_ref(),
            status,
            archival,
            now,
        ));
        self.drawn.insert(wait_row, drawn);
        self.expectations.push(row);
        Ok(())
    }

    /// Draws the checks on one wait item occurrence — each one made, and the one due now — as a
    /// stored wait's are drawn: due at its first check, then one Check every after each one made,
    /// while it is pending and live. Keyed by the occurrence (`WaitRef::Occurrence`).
    fn push_item_checks(
        &mut self,
        state: &CheckState,
        windows: &WaitSources<'_>,
        wait: &Expectation,
        now: NaiveDateTime,
    ) {
        let Some(habit) = wait.origin.habit() else {
            return;
        };
        let wait_ref = WaitRef::Occurrence(occurrence_key(habit).node_key());
        let made = windows
            .checks
            .get(&wait_ref)
            .map_or(&[][..], Vec::as_slice)
            .to_vec();
        let draw = |due_at: NaiveDateTime, done: bool| CheckDraw {
            key: CheckKey {
                wait: wait_ref.clone(),
                due_at,
            },
            wait_title: &wait.title,
            wait_row: wait.id.clone(),
            due: waits::check_window(due_at),
            done,
            is_private: wait.is_private,
        };
        for check in &made {
            self.push_check(state, draw(check.due_at, true));
        }
        let due = waits::stored_check_due(wait).filter(|due| waits::is_due(*due, now));
        if let Some(due_at) = due {
            let open = draw(due_at, false);
            self.lifecycles.push(wait_lifecycle(
                "task",
                DerivedKey::Check(open.key.clone()).node_id(),
                Some(&open.due),
                wait.status,
                wait.archival,
                now,
            ));
            self.push_check(state, open);
        }
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
        // A check task keeps the ordinary model: its status is the check, done once it is made.
        let status = if draw.done {
            Status::Ordinary(TaskStatus::Done)
        } else {
            overlay
                .status
                .as_deref()
                .and_then(TaskStatus::from_db)
                .map_or(Status::Ordinary(TaskStatus::Todo), Status::Ordinary)
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
                    derived: None,
                    until: None,
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
            compound: false,
            async_template: None,
            agentic_brief: None,
            time_scope: Some(draw.due),
            on_scope_exit: None,
            plan,
            due_scope: None,
            archival: overlay
                .archival
                .as_deref()
                .and_then(TaskArchival::from_db)
                .unwrap_or_default(),
            tag_ids,
            position: overlay.position.unwrap_or(i64::MIN),
            is_private: overlay.is_private.unwrap_or(draw.is_private),
            origin,
        });
    }
}

#[cfg(test)]
mod tests;
