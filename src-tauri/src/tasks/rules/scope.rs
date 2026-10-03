//! The scope rules: whether a write's windows nest (the containment invariants), whether a Task
//! as a write leaves it is Overdue, a Goal's stored Archival, and a wait's lifecycle.
//!
//! Pure functions over resolved windows and rows. The reads that gather those windows live in
//! `tasks::scope_rules`, which calls these; see ADR 0010.

use std::collections::HashSet;

use chrono::NaiveDateTime;

use crate::nodes::id::NodeId;
use crate::scopes::resolve::{self, Bounds};

use crate::tasks::error::TaskError;
use crate::tasks::expectations::EXPECTATION;
use crate::tasks::lifecycle::{
    derive_archival, derive_expectation_state, derive_overdue, derive_resolution, derive_timing,
    effective_due, Archival, ItemLifecycle, Timing,
};
use crate::tasks::model::{
    Expectation, ExpectationArchival, ExpectationStatus, GoalStatus, OnScopeExit, TaskArchival,
    TimeScope,
};

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
    if let (Some(own), Some(plan), false) = (windows.own_scope, windows.plan, windows.overdue) {
        reject_unless_contained(own, plan, "plan is not within the task's time scope")?;
    }
    if let (Some(ancestor), Some(own)) = (windows.ancestor_scope, windows.own_scope) {
        reject_unless_contained(
            ancestor,
            own,
            "time scope is not within the parent's time scope",
        )?;
    }
    if let (Some(ancestor), Some(plan)) = (windows.ancestor_plan, windows.plan) {
        reject_unless_contained(ancestor, plan, "plan is not within the parent task's plan")?;
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

#[cfg(test)]
mod tests;
