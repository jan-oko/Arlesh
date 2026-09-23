//! Scope-containment rules shared by the Task and Goal operations.
//!
//! Containment is evaluated as interval containment on resolved datetime boundaries. Tasks and
//! Goals form a contiguous scoped chain (Domains/Projects/Aspects carry no scope and only parent
//! other Domains), so "nearest scoped ancestor" walks only the task/goal links directly above an
//! item. A null Time Scope inherits that ancestor's window.
//!
//! Every rule here reads tasks, goals *and* scopes, which is why each is a free function over a
//! [`Db`] session rather than a method on one resource's operator — see [`Db`]'s
//! `# Where an operation lives`. All of them are read-only analysis, so they are generic over the
//! session mode and serve `connect()` and `begin()` alike.
//!
//! None of them walks the tree itself. [`ancestry::climb`] reads the chain once and each rule is
//! a pure search over it, which is also where the broken-chain policy is chosen: the renderer
//! takes [`Search::or_unconstrained`](super::ancestry::Search::or_unconstrained) and keeps going,
//! a write takes [`Search::or_reject`](super::ancestry::Search::or_reject) and refuses.

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::database::session::{Db, SessionMode};
use crate::scopes::model::ScopeId;
use crate::scopes::resolve::{self, Bounds};

use super::ancestry;
use super::commitments;
use super::error::TaskError;
use super::expectations;
use super::lifecycle::{
    derive_commitment_state, derive_expectation_state, derive_item_state, Archival, ItemLifecycle,
};
use super::model::{
    CommitmentId, ExpectationArchival, ExpectationStatus, GoalId, GoalStatus, OnScopeExit, TaskId,
    TaskStatus, TimeScope,
};

/// Maps a Goal's stored status to its baseline Archival value, for [`derive_item_state`]'s `stored`
/// parameter. `Achieved` intentionally maps to `Live`, not `Archived` — achievement is a separate,
/// additive concept (the Resolution axis' `Completed`), not the Archival axis. An unrecognized
/// status defensively falls back to `Live` (the least surprising default — never silently archives
/// or freezes something).
fn goal_stored_archival(status: &str) -> Archival {
    match GoalStatus::from_db(status) {
        Some(GoalStatus::Frozen) => Archival::Frozen,
        Some(GoalStatus::Archived) => Archival::Archived,
        Some(GoalStatus::Active) | Some(GoalStatus::Achieved) | None => Archival::Live,
    }
}

/// A descendant whose explicit Time Scope would fall outside a candidate window — i.e. one that
/// narrowing an ancestor's scope (or reparenting) would orphan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ViolatingDescendant {
    /// `"task"` or `"goal"`.
    pub node_type: String,
    /// The descendant's id.
    pub node_id: i64,
}

/// The effective `(window, on-exit behavior)` governing an item: its own when explicitly scoped,
/// else the nearest scoped ancestor's, or `None` when nothing above it is scoped (Unscoped). Unlike
/// [`nearest_scoped_ancestor_window`], the chain includes the node itself — this one climbs from
/// the node, the ancestor searches climb from its parent.
///
/// On the **read** path: a broken chain leaves the item unconstrained rather than failing, so one
/// corrupt row cannot blank the whole mindmap. The break is logged rather than swallowed.
pub(super) async fn scope_governance<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
) -> Result<Option<(Bounds, OnScopeExit)>, TaskError> {
    let chain = ancestry::climb(db, node_type, node_id).await?;
    let Some((time_scope, on_exit)) = chain.nearest_scoped().or_unconstrained() else {
        return Ok(None);
    };
    Ok(Some((time_scope_window(db, time_scope).await?, on_exit)))
}

/// Derives the full lifecycle state (Timing / Resolution / Archival — see `lifecycle`'s module
/// docs) of every Task, Goal and Commitment at `now`, using each item's effective governance. A
/// Task is resolved once Done; a Goal once Achieved or Archived. Both carry a stored Archival: a
/// Task its Backlog column, a Goal its status via [`goal_stored_archival`].
///
/// A Commitment takes the third branch, and it is not a special case of the first two: its
/// Resolution axis is replaced by a recorded Verdict that nothing here derives, and its Archival
/// comes from the Verdict Window rather than from On-exit behavior. See
/// [`derive_commitment_state`].
///
/// Reads only — nothing is persisted, so a pooled session is enough.
pub async fn derive_all_scope_lifecycles<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
) -> Result<Vec<ItemLifecycle>, TaskError> {
    let mut out = Vec::new();
    for task in db.tasks().list().await? {
        let (window, on_exit) = match scope_governance(db, "task", task.id).await? {
            Some((w, e)) => (Some(w), Some(e)),
            None => (None, None),
        };
        let resolved = TaskStatus::from_db(&task.status) == Some(TaskStatus::Done);
        let stored = Some(Archival::from(task.archival));
        let state = derive_item_state(window, on_exit, resolved, stored, now);
        out.push(ItemLifecycle {
            node_type: "task".to_string(),
            node_id: task.id,
            timing: state.timing,
            resolution: state.resolution,
            verdict: None,
            archival: state.archival,
            archival_conflict: state.archival_conflict,
        });
    }
    for goal in db.goals().list().await? {
        let (window, on_exit) = match scope_governance(db, "goal", goal.id).await? {
            Some((w, e)) => (Some(w), Some(e)),
            None => (None, None),
        };
        let parsed_status = GoalStatus::from_db(&goal.status);
        let resolved = matches!(
            parsed_status,
            Some(GoalStatus::Achieved) | Some(GoalStatus::Archived)
        );
        let stored = Some(goal_stored_archival(&goal.status));
        let state = derive_item_state(window, on_exit, resolved, stored, now);
        out.push(ItemLifecycle {
            node_type: "goal".to_string(),
            node_id: goal.id,
            timing: state.timing,
            resolution: state.resolution,
            verdict: None,
            archival: state.archival,
            archival_conflict: state.archival_conflict,
        });
    }
    for commitment in db.commitments().list().await? {
        let window = scope_governance(db, "commitment", commitment.id)
            .await?
            .map(|(window, _)| window);
        let verdict_window =
            commitments::effective_verdict_window(db, CommitmentId(commitment.id)).await?;
        let state =
            derive_commitment_state(window, commitment.verdict, verdict_window.as_ref(), now);
        out.push(ItemLifecycle {
            node_type: "commitment".to_string(),
            node_id: commitment.id,
            timing: state.timing,
            // Resolution is the Task/Goal axis; a Commitment answers with its Verdict instead,
            // and sending both would invite a consumer to read one as a fallback for the other.
            resolution: None,
            verdict: Some(state.verdict),
            archival: state.archival,
            // Nothing on a Commitment is manually archived, so nothing can be overridden.
            archival_conflict: false,
        });
    }
    // A wait's entries: `expectation` times a stored wait's own Time Scope, `expectation_check`
    // the day its next check is due; `spawned_wait` and `spawned_check` do the same for the wait an
    // Asynchronous task's completion spawned, keyed by the task. A wait is never Missed, so a
    // passed window with the wait pending is Overdue.
    let windows = super::waits::derive_wait_windows(db).await?;
    let checks: std::collections::HashMap<i64, TimeScope> = windows
        .expectation_checks
        .into_iter()
        .map(|check| (check.expectation_id, check.due))
        .collect();
    let mut entries: Vec<WaitEntry> = Vec::new();
    for expectation in db.expectations().list().await? {
        entries.push(WaitEntry {
            node_type: expectations::EXPECTATION,
            node_id: expectation.id,
            window: expectation.time_scope.clone(),
            status: expectation.status,
            archival: expectation.archival,
        });
        if let Some(due) = checks.get(&expectation.id) {
            entries.push(WaitEntry {
                node_type: expectations::EXPECTATION_CHECK,
                node_id: expectation.id,
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
            node_type: expectations::SPAWNED_WAIT,
            node_id: task_id,
            window: spawned.time_scope,
            status,
            archival,
        });
        if let Some(due) = spawned.next_check {
            entries.push(WaitEntry {
                node_type: expectations::SPAWNED_CHECK,
                node_id: task_id,
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
        let bounds = match &window {
            Some(window) => Some(time_scope_window(db, window).await?),
            None => None,
        };
        let state = derive_expectation_state(bounds, status, archival, now);
        out.push(ItemLifecycle {
            node_type: node_type.to_string(),
            node_id,
            timing: state.timing,
            resolution: state.resolution,
            verdict: None,
            archival: state.archival,
            // Nothing is derived over a wait's own archive, so nothing can be overridden.
            archival_conflict: false,
        });
    }
    Ok(out)
}

/// One lifecycle entry a wait sends: which window it times, for which node, and the wait's state.
struct WaitEntry {
    node_type: &'static str,
    node_id: i64,
    window: Option<TimeScope>,
    status: ExpectationStatus,
    archival: ExpectationArchival,
}

/// Resolves a single scope id to its half-open datetime window.
pub(super) async fn scope_window<M: SessionMode>(
    db: &mut Db<M>,
    scope_id: i64,
) -> Result<Bounds, TaskError> {
    let scope = db.scopes().get(ScopeId(scope_id)).await?;
    Ok(resolve::scope_bounds(&scope)?)
}

/// Resolves a Time Scope's boundaries to its combined window: the start of the start boundary
/// through the end of the end boundary.
pub async fn time_scope_window<M: SessionMode>(
    db: &mut Db<M>,
    time_scope: &TimeScope,
) -> Result<Bounds, TaskError> {
    let start = scope_window(db, time_scope.start_id).await?.0;
    let end = scope_window(db, time_scope.end_id).await?.1;
    Ok((start, end))
}

fn reject_unless_contained(outer: Bounds, inner: Bounds, message: &str) -> Result<(), TaskError> {
    if resolve::interval_contains(outer, inner) {
        Ok(())
    } else {
        Err(TaskError::ScopeContainment(message.to_string()))
    }
}

/// The four already-resolved windows the containment rules are checked over.
///
/// Every field is optional because every rule is conditional: a rule whose two inputs are not
/// both present has nothing to say and is skipped, which is how a task with no Plan and a goal
/// with no Plan column both fall out of the same check.
#[derive(Debug, Clone, Copy, Default)]
struct ContainmentWindows {
    /// The item's own Time Scope window.
    own_scope: Option<Bounds>,
    /// The item's Plan window.
    plan: Option<Bounds>,
    /// The nearest scoped ancestor's window.
    ancestor_scope: Option<Bounds>,
    /// The nearest planned task ancestor's Plan window.
    ancestor_plan: Option<Bounds>,
}

/// Checks the three containment rules and reports the **first** violation.
///
/// Pure: every window is resolved before it arrives, each exactly once, where the old code
/// climbed twice and re-resolved the same Time Scope up to twice more.
///
/// Reporting only the first violation is deliberate and not an oversight — the frontend acts on
/// one message, and collecting all three is an explicit non-goal. The rule order is the order
/// the old function checked in, so the message a given bad write produces has not changed.
fn check_containment(windows: ContainmentWindows) -> Result<(), TaskError> {
    if let (Some(own), Some(plan)) = (windows.own_scope, windows.plan) {
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
    Ok(())
}

/// Resolves a Time Scope to its window when there is one — once, at the single point the check
/// needs it.
async fn resolve_optional<M: SessionMode>(
    db: &mut Db<M>,
    time_scope: Option<&TimeScope>,
) -> Result<Option<Bounds>, TaskError> {
    match time_scope {
        Some(ts) => Ok(Some(time_scope_window(db, ts).await?)),
        None => Ok(None),
    }
}

/// The window of the nearest ancestor of `(parent_type, parent_id)` — itself included — that has
/// an explicit Time Scope, or `None` if none is scoped.
///
/// On the **write** path: a broken chain rejects, because the constraint the caller is about to
/// check against could not be read.
pub async fn nearest_scoped_ancestor_window<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<Bounds>, TaskError> {
    let chain = ancestry::climb(db, parent_type, parent_id).await?;
    let Some((time_scope, _)) = chain.nearest_scoped().or_reject()? else {
        return Ok(None);
    };
    Ok(Some(time_scope_window(db, time_scope).await?))
}

/// Like [`nearest_scoped_ancestor_window`] but returns the ancestor's Time Scope itself (the clamp
/// target for a reparent), rather than its resolved datetime window.
pub(super) async fn nearest_scoped_ancestor_time_scope<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
) -> Result<Option<TimeScope>, TaskError> {
    let chain = ancestry::climb(db, parent_type, parent_id).await?;
    Ok(chain
        .nearest_scoped()
        .or_reject()?
        .map(|(time_scope, _)| time_scope.clone()))
}

/// The chain a write is validated against.
///
/// Ordinarily the prospective parent's, climbed from there. A node that is an **added child of a
/// Habit occurrence** is the exception: its parent columns hold the occurrence's host rather than
/// the occurrence — a virtual instance has no row for them to point at — so validating against
/// them would check the child against the host's window instead of the one it was written on. Such
/// a node is checked against a chain of exactly one link, the occurrence, which has nothing above
/// it to inherit from.
///
/// `node` is `None` on a create, where there is no row yet and so nothing yet attached. The
/// attachment is written immediately after the row, in the same transaction, and every write to it
/// afterwards passes `Some`.
async fn write_chain<M: SessionMode>(
    db: &mut Db<M>,
    node: Option<(ancestry::NodeKind, i64)>,
    parent_type: &str,
    parent_id: i64,
) -> Result<ancestry::AncestryChain, TaskError> {
    if let Some((kind, id)) = node {
        if let Some(occurrence) = ancestry::occurrence_of(db, kind, id).await? {
            return Ok(ancestry::AncestryChain {
                links: vec![occurrence],
                end: ancestry::ChainEnd::Root,
            });
        }
    }
    ancestry::climb(db, parent_type, parent_id).await
}

/// Rejects a task write that breaks a containment invariant: Plan ⊆ own Time Scope, own Time
/// Scope ⊆ nearest scoped ancestor, and Plan ⊆ nearest planned ancestor. `parent_type`/`parent_id`
/// is the task's effective parent (the new one when reparenting), and `id` the task being written
/// when it already exists — see [`write_chain`].
///
/// **Climbs once.** The old shape walked the chain twice — once for the scoped ancestor and once
/// for the planned one — and resolved the item's own Time Scope up to twice more on top. Here
/// the chain is read once, both searches scan it, and each window is resolved exactly once
/// before [`check_containment`] decides.
///
/// A search is consulted only for the rule that needs it, which is what keeps a broken chain
/// rejecting exactly the writes it rejected before: a write with nothing to check asks nothing
/// of the ancestry and so cannot be refused by it.
pub(super) async fn validate_task_containment<M: SessionMode>(
    db: &mut Db<M>,
    id: Option<TaskId>,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
    plan: &Option<TimeScope>,
) -> Result<(), TaskError> {
    if time_scope.is_none() && plan.is_none() {
        return Ok(());
    }
    let node = id.map(|id| (ancestry::NodeKind::Task, id.0));
    let chain = write_chain(db, node, parent_type, parent_id).await?;
    let ancestor_scope = match time_scope {
        Some(_) => chain.nearest_scoped().or_reject()?.map(|(scope, _)| scope),
        None => None,
    };
    let ancestor_plan = match plan {
        Some(_) => chain.nearest_planned().or_reject()?,
        None => None,
    };

    let own_scope = resolve_optional(db, time_scope.as_ref()).await?;
    let plan_window = resolve_optional(db, plan.as_ref()).await?;
    let ancestor_scope = resolve_optional(db, ancestor_scope).await?;
    let ancestor_plan = resolve_optional(db, ancestor_plan).await?;

    check_containment(ContainmentWindows {
        own_scope,
        plan: plan_window,
        ancestor_scope,
        ancestor_plan,
    })
}

/// Rejects a goal write whose Time Scope is not contained in its nearest scoped ancestor.
///
/// A strict subset of [`validate_task_containment`], and structurally so rather than by
/// repetition: a goal has no Plan, so two of [`ContainmentWindows`]' four fields are absent and
/// the same check reduces to rule two on its own.
pub(super) async fn validate_goal_containment<M: SessionMode>(
    db: &mut Db<M>,
    id: Option<GoalId>,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
) -> Result<(), TaskError> {
    let Some(own) = time_scope else {
        return Ok(());
    };
    let node = id.map(|id| (ancestry::NodeKind::Goal, id.0));
    let chain = write_chain(db, node, parent_type, parent_id).await?;
    let ancestor_scope = chain.nearest_scoped().or_reject()?.map(|(scope, _)| scope);

    let own_scope = Some(time_scope_window(db, own).await?);
    let ancestor_scope = resolve_optional(db, ancestor_scope).await?;

    check_containment(ContainmentWindows {
        own_scope,
        ancestor_scope,
        ..Default::default()
    })
}

/// Rejects a commitment write that leaves it with no **effective** window, or with one that
/// escapes its nearest scoped ancestor's.
///
/// The first half is this kind's own rule and has no counterpart anywhere else in the model.
/// Every other node may be Unscoped, which simply means always-active; a Commitment with no
/// window has nothing to be kept or broken *over*, and no verdict could ever come due on it. So
/// it is refused with [`TaskError::CommitmentUnscoped`] rather than written. An inherited window
/// satisfies the rule — what is required is an effective one, not an own one.
///
/// The second half is the ordinary containment check, reduced (as a goal's is) to rule two
/// alone: a Commitment has no Plan, so two of [`ContainmentWindows`]' four fields are
/// structurally absent.
pub(super) async fn validate_commitment_scope<M: SessionMode>(
    db: &mut Db<M>,
    id: Option<CommitmentId>,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
) -> Result<(), TaskError> {
    let node = id.map(|id| (ancestry::NodeKind::Commitment, id.0));
    let chain = write_chain(db, node, parent_type, parent_id).await?;
    let ancestor = chain.nearest_scoped().or_reject()?.map(|(scope, _)| scope);

    let Some(own) = time_scope else {
        // Nothing of its own, so the ancestor chain is the only thing that can supply a window.
        return match ancestor {
            Some(_) => Ok(()),
            None => Err(TaskError::CommitmentUnscoped),
        };
    };

    let own_scope = Some(time_scope_window(db, own).await?);
    let ancestor_scope = resolve_optional(db, ancestor).await?;
    check_containment(ContainmentWindows {
        own_scope,
        ancestor_scope,
        ..Default::default()
    })
}

/// Refuses an Expectation's Time Scope that escapes its nearest scoped ancestor's window — the rule
/// a Task's window answers. With no window of its own there is nothing to check: unlike a
/// Commitment, a wait may be unscoped, and it inherits nothing.
pub(super) async fn validate_expectation_scope<M: SessionMode>(
    db: &mut Db<M>,
    parent_type: &str,
    parent_id: i64,
    time_scope: &Option<TimeScope>,
) -> Result<(), TaskError> {
    let Some(own) = time_scope else {
        return Ok(());
    };
    let chain = write_chain(db, None, parent_type, parent_id).await?;
    let ancestor = chain.nearest_scoped().or_reject()?.map(|(scope, _)| scope);
    let own_scope = Some(time_scope_window(db, own).await?);
    let ancestor_scope = resolve_optional(db, ancestor).await?;
    check_containment(ContainmentWindows {
        own_scope,
        ancestor_scope,
        ..Default::default()
    })
}

/// Returns the direct task, goal and commitment children of a node, as `(node_type, node_id)`
/// pairs.
async fn child_items<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
) -> Result<Vec<(String, i64)>, TaskError> {
    let mut children = Vec::new();
    let task_ids = db.tasks().child_ids(node_type, node_id).await?;
    children.extend(task_ids.into_iter().map(|id| ("task".to_string(), id)));
    let goal_ids = db.goals().child_ids(node_type, node_id).await?;
    children.extend(goal_ids.into_iter().map(|id| ("goal".to_string(), id)));
    let commitment_ids = db.commitments().child_ids(node_type, node_id).await?;
    children.extend(
        commitment_ids
            .into_iter()
            .map(|id| ("commitment".to_string(), id)),
    );
    Ok(children)
}

async fn item_time_scope<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
) -> Result<Option<TimeScope>, TaskError> {
    match node_type {
        "task" => Ok(db.tasks().get(TaskId(node_id)).await?.time_scope),
        "goal" => Ok(db.goals().get(GoalId(node_id)).await?.time_scope),
        "commitment" => Ok(db
            .commitments()
            .get(CommitmentId(node_id))
            .await?
            .time_scope),
        _ => Ok(None),
    }
}

/// Finds task/goal descendants of `(node_type, node_id)` whose explicit Time Scope is not wholly
/// contained within `window` — the items a narrowing of this node's scope (or a reparent under a
/// tighter window) would orphan. Drives the frontend's clamp-or-cancel prompt.
pub(super) async fn descendants_violating_window<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
    window: Bounds,
) -> Result<Vec<ViolatingDescendant>, TaskError> {
    let mut violators = Vec::new();
    let mut stack = child_items(db, node_type, node_id).await?;
    while let Some((child_type, child_id)) = stack.pop() {
        if let Some(ts) = item_time_scope(db, &child_type, child_id).await? {
            let child_window = time_scope_window(db, &ts).await?;
            if !resolve::interval_contains(window, child_window) {
                violators.push(ViolatingDescendant {
                    node_type: child_type.clone(),
                    node_id: child_id,
                });
            }
        }
        stack.extend(child_items(db, &child_type, child_id).await?);
    }
    Ok(violators)
}

/// The outcome of checking a reparent: the binding ancestor Time Scope (the clamp target) and the
/// items — the node itself and/or its descendants — that would fall outside it.
#[derive(Debug, Clone, Serialize)]
pub struct ReparentConflicts {
    /// The nearest scoped ancestor's Time Scope under the new parent, or null if unconstrained.
    pub ancestor_time_scope: Option<TimeScope>,
    /// The items that would be orphaned (empty if the move is already valid).
    pub conflicts: Vec<ViolatingDescendant>,
}

/// Detects the items a reparent of `(node_type, node_id)` under `(new_parent_type, new_parent_id)`
/// would orphan: the node itself if its Time Scope no longer fits the new nearest-scoped-ancestor
/// window, plus any descendants that don't fit. `ancestor_time_scope` is the clamp target.
///
/// Reads only — nothing is persisted, so a pooled session is enough.
pub async fn reparent_conflicts<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
    new_parent_type: &str,
    new_parent_id: i64,
) -> Result<ReparentConflicts, TaskError> {
    let Some(ancestor) =
        nearest_scoped_ancestor_time_scope(db, new_parent_type, new_parent_id).await?
    else {
        return Ok(ReparentConflicts {
            ancestor_time_scope: None,
            conflicts: Vec::new(),
        });
    };
    let window = time_scope_window(db, &ancestor).await?;
    let mut conflicts = Vec::new();
    if let Some(node_ts) = item_time_scope(db, node_type, node_id).await? {
        if !resolve::interval_contains(window, time_scope_window(db, &node_ts).await?) {
            conflicts.push(ViolatingDescendant {
                node_type: node_type.to_string(),
                node_id,
            });
        }
    }
    conflicts.extend(descendants_violating_window(db, node_type, node_id, window).await?);
    Ok(ReparentConflicts {
        ancestor_time_scope: Some(ancestor),
        conflicts,
    })
}

/// Resolves a candidate Time Scope for a node and returns the descendants it would orphan.
///
/// Reads only — nothing is persisted, so a pooled session is enough.
pub async fn conflicts_for_new_time_scope<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
    time_scope: &TimeScope,
) -> Result<Vec<ViolatingDescendant>, TaskError> {
    let window = time_scope_window(db, time_scope).await?;
    descendants_violating_window(db, node_type, node_id, window).await
}

#[cfg(test)]
mod tests;
