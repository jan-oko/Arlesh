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
use crate::nodes::id::NodeId;
use crate::nodes::key::{CheckKey, DerivedKey};
use crate::scopes::resolve::{self, Bounds};

use super::ancestry;
use super::commitments;
use super::error::TaskError;
use super::expectations::{self, EXPECTATION};
use super::lifecycle::{
    derive_commitment_state, derive_item_state, derive_timing, effective_due, Archival,
    ItemLifecycle,
};
use super::model::{
    CommitmentId, ExpectationArchival, ExpectationStatus, GoalId, GoalStatus, OnScopeExit,
    TaskArchival, TaskId, TimeScope,
};
use super::rules::scope::{check_containment, goal_stored_archival, ContainmentWindows};
pub(super) use super::rules::scope::{is_overdue, WrittenTask};
pub use super::rules::scope::{mark_waits_under_pending, wait_lifecycle};

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
///
/// `exit` says whether a Habit occurrence's window governs what hangs on it — see
/// [`OccurrenceExit`].
pub(super) async fn scope_governance_with<M: SessionMode>(
    db: &mut Db<M>,
    node_type: &str,
    node_id: i64,
    exit: OccurrenceExit,
) -> Result<Option<(Bounds, OnScopeExit)>, TaskError> {
    let chain = ancestry::climb(db, node_type, node_id).await?;
    if exit == OccurrenceExit::Ignored && chain.nearest_scoped_is_occurrence() {
        return Ok(None);
    }
    let Some((time_scope, on_exit)) = chain.nearest_scoped().or_unconstrained() else {
        return Ok(None);
    };
    Ok(Some((time_scope.window(), on_exit)))
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

/// Derives the full lifecycle state (Timing / Resolution / Archival and the Overdue flag — see
/// `lifecycle`'s module docs) of every Task, Goal and Commitment at `now`, using each item's
/// effective governance. A Task is resolved once Done; a Goal once Achieved or Archived. Both carry
/// a stored Archival: a Task its Backlog column, a Goal its status via [`goal_stored_archival`].
///
/// Each is judged Overdue against its [`effective_due`]: a Task's explicit due when it has one,
/// else the default its governance and Backlog give it. A Goal carries no explicit due, so it has
/// only the default.
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
    derive_scope_lifecycles(db, now, OccurrenceExit::Honoured).await
}

/// [`derive_all_scope_lifecycles`], saying whether a Habit occurrence's window governs what hangs
/// on it — see [`OccurrenceExit`].
pub async fn derive_scope_lifecycles<M: SessionMode>(
    db: &mut Db<M>,
    now: NaiveDateTime,
    exit: OccurrenceExit,
) -> Result<Vec<ItemLifecycle>, TaskError> {
    let mut out = Vec::new();
    for task in db.tasks().list().await? {
        let governance = scope_governance_with(db, "task", task.id.require_stored()?, exit).await?;
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
            node_id: task.id,
            timing: state.timing,
            resolution: state.resolution,
            overdue: state.overdue,
            verdict: None,
            archival: state.archival,
            archival_conflict: state.archival_conflict,
            plan_timing,
        });
    }
    for goal in db.goals().list().await? {
        let governance = scope_governance_with(db, "goal", goal.id.require_stored()?, exit).await?;
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
            node_id: goal.id,
            timing: state.timing,
            resolution: state.resolution,
            overdue: state.overdue,
            verdict: None,
            archival: state.archival,
            archival_conflict: state.archival_conflict,
            plan_timing: None,
        });
    }
    for commitment in db.commitments().list().await? {
        let window = scope_governance_with(db, "commitment", commitment.id.require_stored()?, exit)
            .await?
            .map(|(window, _)| window);
        let verdict_window = commitments::effective_verdict_window(
            db,
            CommitmentId(commitment.id.require_stored()?),
        )
        .await?;
        let state =
            derive_commitment_state(window, commitment.verdict, verdict_window.as_ref(), now);
        out.push(ItemLifecycle {
            node_type: "commitment".to_string(),
            node_id: commitment.id,
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
    let windows = super::waits::derive_wait_windows(db, now).await?;
    let checks: std::collections::HashMap<i64, (TimeScope, chrono::NaiveDateTime)> = windows
        .expectation_checks
        .into_iter()
        .filter(|check| check.resolved_at.is_none())
        .map(|check| (check.expectation_id, (check.due, check.due_at)))
        .collect();
    let mut entries: Vec<WaitEntry> = Vec::new();
    for expectation in db.expectations().list().await? {
        let Some(stored_id) = expectation.id.stored() else {
            continue;
        };
        entries.push(WaitEntry {
            node_type: expectations::EXPECTATION,
            node_id: expectation.id.clone(),
            window: expectation.time_scope.clone(),
            status: expectation.status,
            archival: expectation.archival,
        });
        if let Some((due, due_at)) = checks.get(&stored_id) {
            entries.push(WaitEntry {
                node_type: "task",
                node_id: check_row_id(super::waits::WaitRef::Stored(stored_id), *due_at),
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
            node_type: expectations::EXPECTATION,
            node_id: DerivedKey::SpawnedWait(NodeId::Stored(task_id)).node_id(),
            window: spawned.time_scope,
            status,
            archival,
        });
        if let (Some(due), Some(due_at)) = (spawned.next_check, spawned.next_check_at) {
            entries.push(WaitEntry {
                node_type: "task",
                node_id: check_row_id(super::waits::WaitRef::Spawned(task_id), due_at),
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
    Ok(out)
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
fn check_row_id(wait: super::waits::WaitRef, due_at: chrono::NaiveDateTime) -> NodeId {
    DerivedKey::Check(CheckKey { wait, due_at }).node_id()
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
    Ok(Some(time_scope.window()))
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
/// Scope ⊆ nearest scoped ancestor, Plan ⊆ nearest planned ancestor, and an explicit Due ⊆ its
/// effective Time Scope. `parent_type`/`parent_id` is the task's effective parent (the new one when
/// reparenting), and `id` the task being written when it already exists — see [`write_chain`].
/// Whether the task is [`is_overdue`] at `now`, which lifts the first rule alone, is judged here.
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
    task: &WrittenTask<'_>,
    now: NaiveDateTime,
) -> Result<(), TaskError> {
    let WrittenTask {
        time_scope,
        plan,
        due_scope,
        ..
    } = *task;
    if time_scope.is_none() && plan.is_none() && due_scope.is_none() {
        return Ok(());
    }
    let node = id.map(|id| (ancestry::NodeKind::Task, id.0));
    let chain = write_chain(db, node, parent_type, parent_id).await?;
    // The due of a task with no window of its own is held to the inherited one, so the scoped
    // ancestor is read for either.
    let ancestor_scope = match (time_scope, due_scope) {
        (None, None) => None,
        _ => chain.nearest_scoped().or_reject()?.map(|(scope, _)| scope),
    };
    let ancestor_plan = match plan {
        Some(_) => chain.nearest_planned().or_reject()?,
        None => None,
    };

    let own_scope = time_scope.as_ref().map(TimeScope::window);
    let plan_window = plan.as_ref().map(TimeScope::window);
    let ancestor_scope = ancestor_scope.map(TimeScope::window);
    let ancestor_plan = ancestor_plan.map(TimeScope::window);

    check_containment(ContainmentWindows {
        own_scope,
        plan: plan_window,
        ancestor_scope,
        ancestor_plan,
        due: due_scope.as_ref().map(TimeScope::window),
        overdue: is_overdue(task, now),
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

    let own_scope = Some(own.window());
    let ancestor_scope = ancestor_scope.map(TimeScope::window);

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

    let own_scope = Some(own.window());
    let ancestor_scope = ancestor.map(TimeScope::window);
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
    let own_scope = Some(own.window());
    let ancestor_scope = ancestor.map(TimeScope::window);
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
            let child_window = ts.window();
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
    let window = ancestor.window();
    let mut conflicts = Vec::new();
    if let Some(node_ts) = item_time_scope(db, node_type, node_id).await? {
        if !resolve::interval_contains(window, node_ts.window()) {
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
    let window = time_scope.window();
    descendants_violating_window(db, node_type, node_id, window).await
}
