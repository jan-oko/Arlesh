//! The scope rules: whether a write's windows nest (the containment invariants), whether a Task
//! as a write leaves it is Overdue, a Goal's stored Archival, and a wait's lifecycle.
//!
//! Pure functions over resolved windows and rows. The reads that gather those windows live in
//! `tasks::scope_rules`, which calls these; see ADR 0010.

use std::collections::HashSet;

use chrono::NaiveDateTime;

use crate::nodes::id::NodeId;
use crate::nodes::key::{CheckKey, DerivedKey};
use crate::scopes::resolve::{self, Bounds};

use crate::tasks::error::TaskError;
use crate::tasks::expectations::EXPECTATION;
use crate::tasks::lifecycle::{
    derive_archival, derive_commitment_state, derive_expectation_state, derive_item_state,
    derive_overdue, derive_resolution, derive_timing, effective_due, Archival, ItemLifecycle,
    Timing,
};
use crate::tasks::model::{
    Commitment, Expectation, ExpectationArchival, ExpectationStatus, Goal, GoalStatus, OnScopeExit,
    Task, TaskArchival, TimeScope,
};
use crate::tasks::rules::ancestry::{climb_in, AncestryChain, AncestryIndex};
use crate::tasks::waits::{WaitRef, WaitWindows};

/// Maps a Goal's stored status to its baseline Archival value, for [`derive_item_state`](crate::tasks::lifecycle::derive_item_state)'s `stored`
/// parameter. `Achieved` intentionally maps to `Live`, not `Archived` — achievement is a separate,
/// additive concept (the Resolution axis' `Completed`), not the Archival axis. An unrecognized
/// status defensively falls back to `Live` (the least surprising default — never silently archives
/// or freezes something).
pub(in crate::tasks) fn goal_stored_archival(status: &str) -> Archival {
    match GoalStatus::from_db(status) {
        Some(GoalStatus::Frozen) => Archival::Frozen,
        Some(GoalStatus::Archived) => Archival::Archived,
        Some(GoalStatus::Active) | Some(GoalStatus::Achieved) | None => Archival::Live,
    }
}

/// The lifecycle a wait — or its open check task — is sent: its window's Timing, never Missed (a
/// passed window with the wait pending is flagged Overdue), and the wait's own archive.
pub fn wait_lifecycle(
    node_type: &str,
    node_id: NodeId,
    window: Option<&TimeScope>,
    status: ExpectationStatus,
    archival: ExpectationArchival,
    now: chrono::NaiveDateTime,
) -> ItemLifecycle {
    let state = derive_expectation_state(window.map(TimeScope::window), status, archival, now);
    ItemLifecycle {
        node_type: node_type.to_string(),
        node_id,
        timing: state.timing,
        resolution: state.resolution,
        overdue: state.overdue,
        verdict: None,
        archival: state.archival,
        // Nothing is derived over a wait's own archive, so nothing can be overridden.
        archival_conflict: false,
        // A wait is never scheduled, and nor is its check: neither has a Plan.
        plan_timing: None,
    }
}

/// Marks **Pending** every wait with no window of its own that hangs under an item whose window
/// has not begun, adding the entry when the wait sent none (a delegated Task's wait sends none).
///
/// A wait's window is its own: it inherits none, so it outlives the work it hangs under and is
/// never Overdue because that work's window passed — the spawned wait of a Task done yesterday is
/// still being waited on today. But before the window it sits in has **begun**, it is not in scope
/// any more than that work is (ruled by the user, 2026-09-27): an unscoped wait under a Task
/// scoped to next month is not something to look at now. Its parent's own entry already says
/// so — a Task's, Goal's or Commitment's Timing is its *effective* window's, the nearest scoped
/// ancestor's when it has none — so this reads it there rather than climbing the tree again.
///
/// Stored and derived waits alike, which is why it runs over the whole load's rows once they are
/// all in, rather than inside any one derivation.
pub fn mark_waits_under_pending(expectations: &[Expectation], lifecycles: &mut Vec<ItemLifecycle>) {
    let pending: HashSet<(String, NodeId)> = lifecycles
        .iter()
        .filter(|entry| entry.timing == Timing::Pending && entry.node_type != EXPECTATION)
        .map(|entry| (entry.node_type.clone(), entry.node_id.clone()))
        .collect();
    for wait in expectations.iter().filter(|wait| wait.time_scope.is_none()) {
        if !pending.contains(&(wait.parent_type.clone(), wait.parent_id.clone())) {
            continue;
        }
        let mut found = false;
        for entry in lifecycles
            .iter_mut()
            .filter(|entry| entry.node_type == EXPECTATION && entry.node_id == wait.id)
        {
            entry.timing = Timing::Pending;
            entry.resolution = None;
            entry.overdue = false;
            found = true;
        }
        if !found {
            // No window is passed, so the instant is never read.
            lifecycles.push(ItemLifecycle {
                timing: Timing::Pending,
                ..wait_lifecycle(
                    EXPECTATION,
                    wait.id.clone(),
                    None,
                    wait.status,
                    wait.archival,
                    NaiveDateTime::MIN,
                )
            });
        }
    }
}

fn reject_unless_contained(outer: Bounds, inner: Bounds, message: &str) -> Result<(), TaskError> {
    if resolve::interval_contains(outer, inner) {
        Ok(())
    } else {
        Err(TaskError::ScopeContainment(message.to_string()))
    }
}

/// The already-resolved windows the containment rules are checked over.
///
/// Every field is optional because every rule is conditional: a rule whose two inputs are not
/// both present has nothing to say and is skipped, which is how a task with no Plan and a goal
/// with no Plan column both fall out of the same check.
#[derive(Debug, Clone, Copy, Default)]
pub(in crate::tasks) struct ContainmentWindows {
    /// The item's own Time Scope window.
    pub(in crate::tasks) own_scope: Option<Bounds>,
    /// The item's Plan window.
    pub(in crate::tasks) plan: Option<Bounds>,
    /// The nearest scoped ancestor's window.
    pub(in crate::tasks) ancestor_scope: Option<Bounds>,
    /// The nearest planned task ancestor's Plan window.
    pub(in crate::tasks) ancestor_plan: Option<Bounds>,
    /// The item's explicit due window, which must lie within its effective Time Scope — its own,
    /// else the nearest scoped ancestor's. Unbounded when neither is set.
    pub(in crate::tasks) due: Option<Bounds>,
    /// The item is flagged **Overdue** (see [`is_overdue`]), which lifts rule one alone: its Plan
    /// may leave its Time Scope. The ancestor rules, and the due's own, still hold.
    pub(in crate::tasks) overdue: bool,
}

/// Checks the containment rules and reports the **first** violation.
///
/// Rule one — Plan within the item's own Time Scope — is skipped for an Overdue item, so work
/// past its due can be rescheduled into now or later without its window being widened on the
/// user's behalf. The last — an explicit due within the effective Time Scope — is `Due ⊆
/// TimeScope`, checked after the three older rules so their messages have not changed.
///
/// Pure: every window is resolved before it arrives, each exactly once, where the old code
/// climbed twice and re-resolved the same Time Scope up to twice more.
///
/// Reporting only the first violation is deliberate and not an oversight — the frontend acts on
/// one message, and collecting all three is an explicit non-goal. The rule order is the order
/// the old function checked in, so the message a given bad write produces has not changed.
pub(in crate::tasks) fn check_containment(windows: ContainmentWindows) -> Result<(), TaskError> {
    // Rules one and three are the Plan View's own refusal (`rules::plan`), so the two read alike.
    if let Some(plan) = windows.plan {
        if super::plan::breaks_own_scope(windows.own_scope, windows.overdue, plan) {
            return Err(TaskError::ScopeContainment(
                "plan is not within the task's time scope".to_string(),
            ));
        }
    }
    if let (Some(ancestor), Some(own)) = (windows.ancestor_scope, windows.own_scope) {
        reject_unless_contained(
            ancestor,
            own,
            "time scope is not within the parent's time scope",
        )?;
    }
    if let Some(plan) = windows.plan {
        if super::plan::breaks_parent_plan(windows.ancestor_plan, plan) {
            return Err(TaskError::ScopeContainment(
                "plan is not within the parent task's plan".to_string(),
            ));
        }
    }
    if let (Some(scope), Some(due)) = (windows.own_scope.or(windows.ancestor_scope), windows.due) {
        reject_unless_contained(scope, due, "due is not within the task's time scope")?;
    }
    Ok(())
}

/// The fields of a task, as a write leaves it, that the containment rules and the Overdue flag
/// read.
pub(in crate::tasks) struct WrittenTask<'write> {
    /// Its own Time Scope.
    pub time_scope: &'write Option<TimeScope>,
    /// Its own On-exit behavior.
    pub on_exit: Option<OnScopeExit>,
    /// Its Plan.
    pub plan: &'write Option<TimeScope>,
    /// Its explicit due.
    pub due_scope: &'write Option<TimeScope>,
    /// Its stored Archival.
    pub archival: TaskArchival,
    /// Whether it is Done.
    pub done: bool,
}

/// Whether a task, as a write leaves it, is flagged **Overdue** at `now` — the lifecycle's own
/// flag, derived exactly as [`derive_all_scope_lifecycles`](crate::tasks::derive_all_scope_lifecycles) derives it, over the task's **own**
/// window: unfinished, not effectively Archived, and past the end of its due. A Missed task
/// (Archive-on-exit, window passed) is archived, not overdue, and so is not exempt from anything.
///
/// Only the task's own window is read. An inherited window never bounded the Plan in the first
/// place (rule one reads the own Time Scope alone), so there is nothing for it to lift.
pub(in crate::tasks) fn is_overdue(task: &WrittenTask<'_>, now: NaiveDateTime) -> bool {
    let Some(own) = task.time_scope else {
        return false;
    };
    let window = own.window();
    let timing = derive_timing(Some(window), now);
    let resolution = derive_resolution(timing, task.done, task.on_exit);
    let archival = derive_archival(Some(Archival::from(task.archival)), resolution).effective;
    let governance = Some((window, task.on_exit.unwrap_or(OnScopeExit::Keep)));
    let due = effective_due(
        task.due_scope.as_ref().map(TimeScope::window),
        governance,
        task.archival == TaskArchival::Backlog,
    );
    derive_overdue(due, task.done, archival, now)
}

/// Whether an added child of a Habit occurrence that has no window of its own is governed by its
/// occurrence's window — which archives it with the occurrence when that window passes.
///
/// A compound occurrence's status is worked out **before** its iteration is classified
/// (`docs/spec/habits.md`, *Iteration resolution*), so archival that comes only from the
/// iteration's window passing must not feed back into whether the iteration resolved: that
/// reading takes [`Self::Ignored`]; everywhere else it is [`Self::Honoured`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OccurrenceExit {
    /// The occurrence's window governs what hangs on it, as the board shows it.
    Honoured,
    /// What is governed by nothing but its occurrence's window reads as unscoped.
    Ignored,
}

/// The `(window, on-exit behavior)` governing the node `chain` starts at: its own when explicitly
/// scoped, else the nearest scoped ancestor's, or `None` when nothing above it is scoped
/// (Unscoped).
///
/// On the **read** path: a broken chain leaves the item unconstrained rather than failing, so one
/// corrupt row cannot blank the whole board. The break is logged rather than swallowed.
pub(in crate::tasks) fn governance(
    chain: &AncestryChain,
    exit: OccurrenceExit,
) -> Option<(Bounds, OnScopeExit)> {
    if exit == OccurrenceExit::Ignored && chain.nearest_scoped_is_occurrence() {
        return None;
    }
    let (time_scope, on_exit) = chain.nearest_scoped().or_unconstrained()?;
    Some((time_scope.window(), on_exit))
}

/// The rows a board's lifecycles are derived over.
pub struct LifecycleRows<'rows> {
    /// The stored Tasks.
    pub tasks: &'rows [Task],
    /// The stored Goals.
    pub goals: &'rows [Goal],
    /// The stored Commitments.
    pub commitments: &'rows [Commitment],
    /// The stored Expectations.
    pub expectations: &'rows [Expectation],
    /// Every stored scoped row's ancestry link, and every added child's occurrence.
    pub ancestry: &'rows AncestryIndex,
    /// The waits' check and spawned windows.
    pub wait_windows: WaitWindows,
}

/// Derives the full lifecycle state (Timing / Resolution / Archival and the Overdue flag — see
/// `lifecycle`'s module docs) of every Task, Goal and Commitment at `now`, using each item's
/// effective governance, and every wait's — what
/// [`derive_scope_lifecycles`](crate::tasks::derive_scope_lifecycles) reads the rows for.
///
/// A Task is resolved once Done; a Goal once Achieved or Archived. Both carry a stored Archival: a
/// Task its Backlog column, a Goal its status via [`goal_stored_archival`]. Each is judged Overdue
/// against its [`effective_due`]. A Commitment's Resolution axis is replaced by its recorded
/// Verdict, and its Archival comes from the Verdict Window (see [`derive_commitment_state`]).
pub fn derive_item_lifecycles(
    rows: LifecycleRows<'_>,
    now: NaiveDateTime,
    exit: OccurrenceExit,
) -> Vec<ItemLifecycle> {
    let mut out = Vec::new();
    for task in rows.tasks {
        let Some(id) = task.id.stored() else {
            continue;
        };
        let governance = governance(&climb_in(rows.ancestry, "task", id), exit);
        let (window, on_exit) = governance.unzip();
        let resolved = task.status.is_done();
        let stored = Some(Archival::from(task.archival));
        let due = effective_due(
            task.due_scope.as_ref().map(TimeScope::window),
            governance,
            task.archival == TaskArchival::Backlog,
        );
        let state = derive_item_state(window, on_exit, due, resolved, stored, now);
        let plan_timing = task
            .plan
            .as_ref()
            .map(|plan| derive_timing(Some(plan.window()), now));
        out.push(ItemLifecycle {
            node_type: "task".to_string(),
            node_id: task.id.clone(),
            timing: state.timing,
            resolution: state.resolution,
            overdue: state.overdue,
            verdict: None,
            archival: state.archival,
            archival_conflict: state.archival_conflict,
            plan_timing,
        });
    }
    for goal in rows.goals {
        let Some(id) = goal.id.stored() else {
            continue;
        };
        let governance = governance(&climb_in(rows.ancestry, "goal", id), exit);
        let (window, on_exit) = governance.unzip();
        let parsed_status = GoalStatus::from_db(&goal.status);
        let resolved = matches!(
            parsed_status,
            Some(GoalStatus::Achieved) | Some(GoalStatus::Archived)
        );
        let stored = Some(goal_stored_archival(&goal.status));
        let due = effective_due(None, governance, false);
        let state = derive_item_state(window, on_exit, due, resolved, stored, now);
        out.push(ItemLifecycle {
            node_type: "goal".to_string(),
            node_id: goal.id.clone(),
            timing: state.timing,
            resolution: state.resolution,
            overdue: state.overdue,
            verdict: None,
            archival: state.archival,
            archival_conflict: state.archival_conflict,
            plan_timing: None,
        });
    }
    for commitment in rows.commitments {
        let Some(id) = commitment.id.stored() else {
            continue;
        };
        let chain = climb_in(rows.ancestry, "commitment", id);
        let window = governance(&chain, exit).map(|(window, _)| window);
        let verdict_window = chain.nearest_verdict_window().or_unconstrained().cloned();
        let state =
            derive_commitment_state(window, commitment.verdict, verdict_window.as_ref(), now);
        out.push(ItemLifecycle {
            node_type: "commitment".to_string(),
            node_id: commitment.id.clone(),
            timing: state.timing,
            // Resolution is the Task/Goal axis; a Commitment answers with its Verdict instead,
            // and sending both would invite a consumer to read one as a fallback for the other.
            resolution: None,
            // Nothing on a Commitment comes due: it is judged by its Verdict, not by lateness.
            overdue: false,
            verdict: Some(state.verdict),
            archival: state.archival,
            // Nothing on a Commitment is manually archived, so nothing can be overridden.
            archival_conflict: false,
            // Never scheduled: the window *is* the commitment.
            plan_timing: None,
        });
    }
    // A wait's entries: `expectation` times a wait's own Time Scope — a stored one, or the wait an
    // Asynchronous task's completion spawned, under its derived row id — and `task` the day its
    // open check task is due, under the check task's row id. A wait is never Missed, so a passed
    // window with the wait pending is flagged Overdue.
    let windows = rows.wait_windows;
    let checks: std::collections::HashMap<i64, (TimeScope, chrono::NaiveDateTime)> = windows
        .expectation_checks
        .into_iter()
        .filter(|check| check.resolved_at.is_none())
        .map(|check| (check.expectation_id, (check.due, check.due_at)))
        .collect();
    let mut entries: Vec<WaitEntry> = Vec::new();
    for expectation in rows.expectations {
        let Some(stored_id) = expectation.id.stored() else {
            continue;
        };
        entries.push(WaitEntry {
            node_type: EXPECTATION,
            node_id: expectation.id.clone(),
            window: expectation.time_scope.clone(),
            status: expectation.status,
            archival: expectation.archival,
        });
        if let Some((due, due_at)) = checks.get(&stored_id) {
            entries.push(WaitEntry {
                node_type: "task",
                node_id: check_row_id(WaitRef::Stored(stored_id), *due_at),
                window: Some(due.clone()),
                status: expectation.status,
                archival: expectation.archival,
            });
        }
    }
    for spawned in windows.spawned_waits {
        let (task_id, status, archival) = (
            spawned.wait.task_id,
            spawned.wait.status,
            spawned.wait.archival,
        );
        entries.push(WaitEntry {
            node_type: EXPECTATION,
            node_id: DerivedKey::SpawnedWait(NodeId::Stored(task_id)).node_id(),
            window: spawned.time_scope,
            status,
            archival,
        });
        if let (Some(due), Some(due_at)) = (spawned.next_check, spawned.next_check_at) {
            entries.push(WaitEntry {
                node_type: "task",
                node_id: check_row_id(WaitRef::Spawned(task_id), due_at),
                window: Some(due),
                status,
                archival,
            });
        }
    }
    for WaitEntry {
        node_type,
        node_id,
        window,
        status,
        archival,
    } in entries
    {
        out.push(wait_lifecycle(
            node_type,
            node_id,
            window.as_ref(),
            status,
            archival,
            now,
        ));
    }
    out
}

/// One lifecycle entry a wait sends: which window it times, for which node, and the wait's state.
struct WaitEntry {
    node_type: &'static str,
    node_id: NodeId,
    window: Option<TimeScope>,
    status: ExpectationStatus,
    archival: ExpectationArchival,
}

/// The row id of the check task on a wait due at `due_at`.
fn check_row_id(wait: WaitRef, due_at: chrono::NaiveDateTime) -> NodeId {
    DerivedKey::Check(CheckKey { wait, due_at }).node_id()
}

#[cfg(test)]
mod tests;
