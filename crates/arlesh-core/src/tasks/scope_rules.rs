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
use crate::scopes::resolve::{self, Bounds};

use super::ancestry;
use super::error::TaskError;
use super::lifecycle::ItemLifecycle;
use super::model::{CommitmentId, GoalId, TaskId, TimeScope};
use super::rules::ancestry::AncestryIndex;
use super::rules::scope::{
    check_containment, derive_item_lifecycles, ContainmentWindows, LifecycleRows,
};
pub(super) use super::rules::scope::{is_overdue, WrittenTask};
pub use super::rules::scope::{mark_waits_under_pending, wait_lifecycle, OccurrenceExit};

/// A descendant whose explicit Time Scope would fall outside a candidate window — i.e. one that
/// narrowing an ancestor's scope (or reparenting) would orphan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub struct ViolatingDescendant {
    /// `"task"` or `"goal"`.
    pub node_type: String,
    /// The descendant's id.
    pub node_id: i64,
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
    let tasks = db.tasks().list().await?;
    let goals = db.goals().list().await?;
    let commitments = db.commitments().list().await?;
    let attachments = db.flows().child_attachments().await?;
    let ancestry = AncestryIndex::of(&tasks, &goals, &commitments, attachments);
    let wait_windows = super::waits::derive_wait_windows(db, now).await?;
    let expectations = db.expectations().list().await?;
    Ok(derive_item_lifecycles(
        LifecycleRows {
            tasks: &tasks,
            goals: &goals,
            commitments: &commitments,
            expectations: &expectations,
            ancestry: &ancestry,
            wait_windows,
        },
        now,
        exit,
    ))
}

/// Every stored scoped row's ancestry link, and every added child's occurrence, read once — what
/// a whole board's chains are climbed over in memory ([`climb_in`](super::rules::ancestry::climb_in)).
pub(super) async fn ancestry_index<M: SessionMode>(
    db: &mut Db<M>,
) -> Result<AncestryIndex, TaskError> {
    let tasks = db.tasks().list().await?;
    let goals = db.goals().list().await?;
    let commitments = db.commitments().list().await?;
    let attachments = db.flows().child_attachments().await?;
    Ok(AncestryIndex::of(&tasks, &goals, &commitments, attachments))
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
#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
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
