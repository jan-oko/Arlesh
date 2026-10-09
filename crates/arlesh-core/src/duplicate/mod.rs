//! Cross-domain subtree duplication, backing the Mindmap's Copy+Paste.
//!
//! Cut and Copy are the same gesture up to one question — does the original survive? — and the
//! backend answered only the first of them. A reparent is one `UPDATE`; a copy has no existing
//! row to move, so it needs a traversal of its own, and this is it.
//!
//! A node's children can live in any of the `domains`/`goals`/`tasks`/`commitments`/
//! `expectations`/`infos` tables, keyed by a polymorphic `(parent_type, parent_id)` pair with no
//! foreign key to walk. So the clone is a breadth-first pass: each node is cloned under its
//! already-cloned new parent, and its children are discovered only once that parent's new id
//! exists. Everything the node holds — status, tags, block reasons, Time Scope, on-exit behaviour,
//! Plan, delegate, privacy, position and dependencies — is copied with it.
//!
//! **Commitments and waits come along** with their own subtrees, copied as stored: a
//! Commitment's verdict, as a copied Task keeps its status, and a wait's status, archive, checks
//! and agent fields. Neither holds dependencies of its own. A Commitment or a wait is never the
//! root of a copy: no command copies one on its own, and the Mindmap refuses it on the clipboard.
//!
//! **Started instances keep their origin.** A copied Goal, Task or Commitment that a started Flow
//! materialised is recorded against that **original** Flow, in a new run of its own
//! (`flows::copy_instance_links`), so the copy still reads "from flow X".
//!
//! **Flows come along.** A Flow hanging under a copied node — under a copied Project, Domain or
//! Goal, the only kinds that hold one — is copied with it by `flows::duplicate_flow_with_subtree`,
//! which is `flows::duplicate_flow` (template, items, cycles, flow goals and the Recurrence; no
//! completion history and no started instances) put under the copied parent. The Flows are copied
//! **after** every node, so the Target Node can be settled against the whole copy: a target inside
//! the copied subtree is remapped to its copy, as a parent link is; one outside keeps pointing at
//! the original; a NULL target stays NULL and so follows its parent (`flows::rules::targets`).
//!
//! Two things deliberately do **not** happen here:
//!
//! - **Dependencies are not remapped.** A copied task waits on exactly what the original waits
//!   on, even when that target was itself copied. That is what a plain reparent does, and it is
//!   the conservative reading; Flow instances solve the same problem the other way, by remapping
//!   per instance (ADR 0002), and that is the model to reach for if this proves wrong.
//! - **Occurrence children are left behind.** A row added to a Habit occurrence is stored under
//!   the occurrence's host but belongs to the occurrence, which is derived and has no copy to
//!   attach to — the copied Habit regenerates its own occurrences, with nothing done on them. Such a
//!   row is neither copied as a loose child of the host's copy nor dropped in silence: the walk
//!   skips it and returns it in [`SubtreeCopy::left_behind`], titled, so the paste can name it.
//!   That covers every row hung on an occurrence of a Flow this copy carried, and every row hung
//!   on any occurrence hosted by a node this copy carried.
//!
//! Aspects are never duplicated: they are the fixed, seeded roots of the board.
//!
//! The whole walk runs on the caller's transactional session and never opens one of its own, per
//! ADR 0004 — so a failure part-way leaves the tree exactly as it was, rather than half a subtree.
//! It also makes the paste, Flows included, a single undo step: one command, one Gesture.

use std::collections::{HashSet, VecDeque};

use serde::Serialize;

use crate::access::model::NodeTable;
use crate::database::session::{Db, Transactional};
use crate::domains::error::DomainError;
use crate::domains::model::{
    CreateDomainRequest, DomainId, DomainSubtype, ProjectStatus, UpdateDomainRequest,
};
use crate::error::AppError;
use crate::flows::model::FlowId;
use crate::flows::rules::targets::CopiedNodes;
use crate::infos::model::{CreateInfoRequest, InfoId, UpdateInfoRequest};
use crate::nodes::rules::parenting::stored_reference;
use crate::tasks::model::{
    CommitmentId, CreateGoalRequest, CreateTaskRequest, ExpectationId, GoalId, GoalStatus,
    TaskAgentic, TaskId, UpdateGoalRequest, UpdateTaskRequest,
};

/// A node kind this module can clone — one per table a Mindmap subtree spans.
///
/// The `domains` subtype (Project, Domain or Tag) is read off the row itself and carried over
/// unchanged, so a single [`Domain`](Self::Domain) variant covers all three. Aspects are absent
/// on purpose. Flows are not a kind the walk clones node by node: they are copied whole, after it,
/// by `flows::duplicate_flow_with_subtree` — see the module docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DuplicableKind {
    /// A Project, Domain or Tag, in `domains`.
    Domain,
    /// A Goal, in `goals`.
    Goal,
    /// A Task, in `tasks`.
    Task,
    /// A note, in `infos`.
    Info,
    /// A Commitment, in `commitments`. Copied only as part of a subtree: no command copies one on
    /// its own.
    Commitment,
    /// A wait, in `expectations`. Copied only as part of a subtree, like a Commitment.
    Expectation,
}

impl DuplicableKind {
    /// The table this kind's rows live in.
    fn table(self) -> NodeTable {
        match self {
            Self::Domain => NodeTable::Domain,
            Self::Goal => NodeTable::Goal,
            Self::Task => NodeTable::Task,
            Self::Info => NodeTable::Info,
            Self::Commitment => NodeTable::Commitment,
            Self::Expectation => NodeTable::Expectation,
        }
    }
}

/// What one subtree copy made, and what it could not carry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtreeCopy {
    /// The new root's id.
    pub root_id: i64,
    /// The rows hung on Habit occurrences that the copy could not carry — see the module docs.
    pub left_behind: Vec<LeftBehindChild>,
}

/// One row hung on a Habit occurrence that a copy left behind, titled so the paste can name it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub struct LeftBehindChild {
    /// Which table the row lives in: `task`, `goal`, `commitment`, `expectation` or `info`.
    pub child_type: String,
    /// The row's id.
    pub child_id: i64,
    /// Its display title (an Info's body).
    pub title: String,
}

/// A duplicate command's answer: the copy's root, and what the copy left behind.
#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
#[schemars(rename = "Duplicated{T}")]
pub struct DuplicatedSubtree<T> {
    /// The copy's root, as its own table returns it.
    pub copy: T,
    /// The rows hung on Habit occurrences the copy could not carry, for the paste to name.
    pub left_behind: Vec<LeftBehindChild>,
}

/// A Flow found under a copied node, waiting for the node walk to finish before it is copied.
struct PendingFlow {
    /// The original Flow.
    old_id: i64,
    /// The copied parent's `parent_type` spelling, as the `flows` table takes it.
    new_parent_kind: String,
    /// The copied parent's id.
    new_parent_id: i64,
}

/// What one node holds that the walk must still visit.
#[derive(Default)]
struct Children {
    /// Stored nodes to clone, each pointed at its new parent.
    nodes: Vec<PendingClone>,
    /// Flows to copy once every node exists.
    flows: Vec<PendingFlow>,
}

/// A node still to be cloned: where it comes from, and the already-cloned parent to attach it to.
struct PendingClone {
    /// Which table the source row lives in.
    kind: DuplicableKind,
    /// The source row's id.
    old_id: i64,
    /// The new parent's own kind spelling (`aspect`/`project`/`domain`/`tag`/`goal`/`task`/
    /// `info`). Each table collapses this to whatever its own `parent_type` column accepts.
    new_parent_kind: String,
    /// The new parent's id.
    new_parent_id: i64,
    /// Set only for the root of the duplicated subtree, which lands where the paste put it.
    /// Descendants keep the position they had under the original, so the copy has the same shape.
    forced_position: Option<i64>,
}

/// A freshly written clone: its new id, and the kind spelling its own children must name it by.
struct ClonedNode {
    /// The new row's id.
    new_id: i64,
    /// This node's kind as a `parent_type`/`subtype` column spells it.
    kind: String,
}

/// Deep-clones the subtree rooted at `(kind, id)` under `(target_kind, target_id)`, putting the
/// new root at `position`, and returns the new root's id together with the occurrence children
/// it left behind.
///
/// `target_kind` is the target's kind: `"goal"`, `"task"`, `"commitment"` and the like, or any
/// domains-table spelling for a domains-table target, which the copy stores as `domain`
/// ([`stored_reference`]). It is unused for a domain root (the `domains` table has only a
/// `parent_id`).
///
/// Every Flow under a copied node is copied too, after the nodes, with its Target Node remapped
/// when the copy carried it — see the module docs.
///
/// Atomic, and only as part of the caller's transaction: it takes a `Db<Transactional>` and never
/// commits. Nothing is left behind if any node in the subtree fails to clone.
#[tracing::instrument(skip(db))]
pub async fn duplicate_subtree(
    db: &mut Db<Transactional>,
    kind: DuplicableKind,
    id: i64,
    target_kind: &str,
    target_id: i64,
    position: i64,
) -> Result<SubtreeCopy, AppError> {
    let mut walk = Walk {
        attached: attached_children(db).await?,
        copies: CopiedNodes::default(),
        queue: VecDeque::new(),
        flows: Vec::new(),
    };
    let root_id = walk
        .visit(
            db,
            PendingClone {
                kind,
                old_id: id,
                new_parent_kind: target_kind.to_string(),
                new_parent_id: target_id,
                forced_position: Some(position),
            },
        )
        .await?;
    while let Some(item) = walk.queue.pop_front() {
        walk.visit(db, item).await?;
    }
    let Walk { copies, flows, .. } = walk;
    let mut copied_flows = HashSet::new();
    for flow in flows {
        crate::flows::duplicate_flow_with_subtree(
            db,
            FlowId(flow.old_id),
            &flow.new_parent_kind,
            flow.new_parent_id,
            &copies,
        )
        .await?;
        copied_flows.insert(flow.old_id);
    }
    crate::flows::copy_instance_links(db, &copies).await?;
    let left_behind = left_behind(db, &copies, &copied_flows).await?;
    Ok(SubtreeCopy {
        root_id,
        left_behind,
    })
}

/// The breadth-first walk's state: what it has copied, and what it has still to visit.
struct Walk {
    /// Every row hung on a Habit occurrence, which the walk skips.
    attached: HashSet<(String, i64)>,
    /// Every node copied so far, original against copy.
    copies: CopiedNodes,
    /// Nodes whose parents are copied and which are not yet copied themselves.
    queue: VecDeque<PendingClone>,
    /// Flows found under copied nodes, copied once the walk is done.
    flows: Vec<PendingFlow>,
}

impl Walk {
    /// Clones one node, records the copy, queues what it holds, and returns the copy's id.
    async fn visit(
        &mut self,
        db: &mut Db<Transactional>,
        item: PendingClone,
    ) -> Result<i64, AppError> {
        let cloned = clone_node(db, &item).await?;
        self.copies
            .record(item.kind.table(), item.old_id, cloned.new_id);
        let children = children_of(db, &item, &cloned, &self.attached).await?;
        self.queue.extend(children.nodes);
        self.flows.extend(children.flows);
        Ok(cloned.new_id)
    }
}

/// Every stored row hung on a Habit occurrence, by `(child_type, child_id)` — the rows the walk
/// must not clone as plain children of their host.
async fn attached_children(db: &mut Db<Transactional>) -> Result<HashSet<(String, i64)>, AppError> {
    Ok(db
        .flows()
        .child_attachments()
        .await?
        .into_iter()
        .map(|(child_type, child_id, _)| (child_type, child_id))
        .collect())
}

/// The occurrence children this copy could not carry: every row hung on an occurrence of a Flow
/// it copied, or on any occurrence hosted by a node it copied. Each is titled, in attachment
/// order, so the same copy always names them the same way.
async fn left_behind(
    db: &mut Db<Transactional>,
    copies: &CopiedNodes,
    copied_flows: &HashSet<i64>,
) -> Result<Vec<LeftBehindChild>, AppError> {
    let mut left = Vec::new();
    for child in db.flows().list_all_instance_children().await? {
        let row = occurrence_child_row(db, &child.child_type, child.child_id).await?;
        let hosted_inside = row
            .host_id
            .is_some_and(|host_id| copies.contains(&row.host_type, host_id));
        if !hosted_inside && !copied_flows.contains(&child.flow_id) {
            continue;
        }
        left.push(LeftBehindChild {
            child_type: child.child_type,
            child_id: child.child_id,
            title: row.title,
        });
    }
    Ok(left)
}

/// What [`left_behind`] reads of one occurrence child: where its row is stored, and its title.
struct OccurrenceChildRow {
    /// The host's `parent_type` spelling.
    host_type: String,
    /// The host's id, when the row's parent is a stored one.
    host_id: Option<i64>,
    /// The display title (an Info's body).
    title: String,
}

/// Reads one occurrence child's host and title from its own table.
async fn occurrence_child_row(
    db: &mut Db<Transactional>,
    child_type: &str,
    child_id: i64,
) -> Result<OccurrenceChildRow, AppError> {
    let (host_type, host_id, title) = match child_type {
        "task" => {
            let row = db.tasks().get(TaskId(child_id)).await?;
            (row.parent_type, row.parent_id.stored(), row.title)
        }
        "goal" => {
            let row = db.goals().get(GoalId(child_id)).await?;
            (row.parent_type, row.parent_id.stored(), row.title)
        }
        "commitment" => {
            let row = db.commitments().get(CommitmentId(child_id)).await?;
            (row.parent_type, row.parent_id.stored(), row.title)
        }
        "expectation" => {
            let row = db.expectations().get(ExpectationId(child_id)).await?;
            (row.parent_type, row.parent_id.stored(), row.title)
        }
        _ => {
            let row = db.infos().get(InfoId(child_id)).await?;
            (row.parent_type, row.parent_id.stored(), row.body)
        }
    };
    Ok(OccurrenceChildRow {
        host_type,
        host_id,
        title,
    })
}

/// Clones one node, without touching its children.
async fn clone_node(
    db: &mut Db<Transactional>,
    item: &PendingClone,
) -> Result<ClonedNode, AppError> {
    match item.kind {
        DuplicableKind::Domain => clone_domain(db, item).await,
        DuplicableKind::Goal => clone_goal(db, item).await,
        DuplicableKind::Task => clone_task(db, item).await,
        DuplicableKind::Info => clone_info(db, item).await,
        DuplicableKind::Commitment => clone_commitment(db, item).await,
        DuplicableKind::Expectation => clone_expectation(db, item).await,
    }
}

/// The direct children of a just-cloned node, each already pointed at its new parent, and the
/// Flows hanging under it.
///
/// Children are found under the spelling of the original's table ([`NodeTable::as_str`]), which is
/// how every reference column names a parent — `domain` for any domains-table row (migration
/// 0096). The copies get `cloned.kind`, which each clone function stores the same way
/// ([`stored_reference`]). A row in `attached` hangs on a Habit occurrence rather than on this
/// node, so it is skipped here and named by [`left_behind`] instead.
async fn children_of(
    db: &mut Db<Transactional>,
    item: &PendingClone,
    cloned: &ClonedNode,
    attached: &HashSet<(String, i64)>,
) -> Result<Children, AppError> {
    let old_id = item.old_id;
    let mut children: Vec<(DuplicableKind, i64)> = Vec::new();
    if item.kind == DuplicableKind::Domain {
        // The `domains` table names its parent by `parent_id` alone, so no spelling applies.
        let ids = child_ids(db, DuplicableKind::Domain, "", old_id).await?;
        extend(&mut children, DuplicableKind::Domain, ids);
    }
    let parent_type = item.kind.table().as_str();
    for child_kind in held_kinds(item.kind) {
        let ids = child_ids(db, *child_kind, parent_type, old_id).await?;
        extend(&mut children, *child_kind, ids);
    }
    let nodes = children
        .into_iter()
        // `derived_children.child_type` names a row by its table, as `NodeTable` spells it.
        .filter(|(kind, child_id)| {
            !attached.contains(&(kind.table().as_str().to_string(), *child_id))
        })
        .map(|(kind, child_id)| PendingClone {
            kind,
            old_id: child_id,
            new_parent_kind: cloned.kind.clone(),
            new_parent_id: cloned.new_id,
            forced_position: None,
        })
        .collect();
    // A Tag holds no Flow, so `ids_under` finds none under one.
    let flows = db
        .flows()
        .ids_under(item.kind.table(), old_id)
        .await?
        .into_iter()
        .map(|flow_id| PendingFlow {
            old_id: flow_id,
            new_parent_kind: cloned.kind.clone(),
            new_parent_id: cloned.new_id,
        })
        .collect();
    Ok(Children { nodes, flows })
}

/// The kinds a node of `kind` can hold, besides the domains-table children only a domains-table
/// row holds, in the order the walk clones them.
fn held_kinds(kind: DuplicableKind) -> &'static [DuplicableKind] {
    use DuplicableKind::{Commitment, Expectation, Goal, Info, Task};
    match kind {
        DuplicableKind::Domain | Goal => &[Goal, Task, Commitment, Expectation, Info],
        // A Task and a Commitment hold the same kinds: Tasks, Commitments, waits and notes.
        Task | Commitment => &[Task, Commitment, Expectation, Info],
        Expectation | Info => &[Info],
    }
}

/// The ids of the rows of `kind`'s table stored under `(parent_type, parent_id)`. A domains-table
/// row's children are found by `parent_id` alone, and `parent_type` is unused for them.
async fn child_ids(
    db: &mut Db<Transactional>,
    kind: DuplicableKind,
    parent_type: &str,
    parent_id: i64,
) -> Result<Vec<i64>, AppError> {
    Ok(match kind {
        DuplicableKind::Domain => db.domains().child_ids(DomainId(parent_id)).await?,
        DuplicableKind::Goal => db.goals().child_ids(parent_type, parent_id).await?,
        DuplicableKind::Task => db.tasks().child_ids(parent_type, parent_id).await?,
        DuplicableKind::Commitment => db.commitments().child_ids(parent_type, parent_id).await?,
        DuplicableKind::Expectation => db.expectations().child_ids(parent_type, parent_id).await?,
        DuplicableKind::Info => db.infos().child_ids(parent_type, parent_id).await?,
    })
}

/// Tags each id in `ids` with its kind and appends them to `children`.
fn extend(children: &mut Vec<(DuplicableKind, i64)>, kind: DuplicableKind, ids: Vec<i64>) {
    children.extend(ids.into_iter().map(|id| (kind, id)));
}

/// Clones a Project, Domain or Tag row.
async fn clone_domain(
    db: &mut Db<Transactional>,
    item: &PendingClone,
) -> Result<ClonedNode, AppError> {
    let original = db.domains().get(DomainId(item.old_id)).await?;
    // `from_db` has no `Aspect` spelling, so an aspect that reached here — a caller that skipped
    // the frontend's own check — is refused with the message the UI already knows.
    let subtype = DomainSubtype::from_db(&original.subtype).ok_or(DomainError::FixedAspect)?;
    let created = db
        .domains()
        .create(CreateDomainRequest {
            title: original.title.clone(),
            description: original.description.clone(),
            subtype,
            parent_id: Some(item.new_parent_id),
            status: original.status.as_deref().and_then(ProjectStatus::from_db),
            knowledge_base_directory: original.knowledge_base_directory.clone(),
        })
        .await?;
    db.domains()
        .update(
            DomainId(created.id),
            UpdateDomainRequest {
                position: Some(item.forced_position.unwrap_or(original.position)),
                is_private: Some(original.is_private),
                ..Default::default()
            },
        )
        .await?;
    Ok(ClonedNode {
        new_id: created.id,
        kind: original.subtype,
    })
}

/// Clones a goal row, with its tags and block reasons.
async fn clone_goal(
    db: &mut Db<Transactional>,
    item: &PendingClone,
) -> Result<ClonedNode, AppError> {
    let original = db.goals().get(GoalId(item.old_id)).await?;
    let created = crate::tasks::create_goal(
        db,
        CreateGoalRequest {
            title: original.title.clone(),
            parent_type: stored_reference(&item.new_parent_kind).to_string(),
            parent_id: item.new_parent_id.into(),
            status: GoalStatus::from_db(&original.status),
            time_scope: original.time_scope.clone(),
            on_scope_exit: original.on_scope_exit,
        },
    )
    .await?;
    let created_id = created.id.require_stored()?;
    crate::tasks::update_goal(
        db,
        GoalId(created_id),
        UpdateGoalRequest {
            position: Some(item.forced_position.unwrap_or(original.position)),
            is_private: Some(original.is_private),
            ..Default::default()
        },
    )
    .await?;
    for tag_id in &original.tag_ids {
        db.goals().add_tag(GoalId(created_id), *tag_id).await?;
    }
    carry_block_reasons(db, "goal", item.old_id, created_id).await?;
    Ok(ClonedNode {
        new_id: created_id,
        kind: "goal".to_string(),
    })
}

/// Clones a task row, with its tags, block reasons and dependencies.
async fn clone_task(
    db: &mut Db<Transactional>,
    item: &PendingClone,
) -> Result<ClonedNode, AppError> {
    let original = db.tasks().get(TaskId(item.old_id)).await?;
    let created = crate::tasks::create_task(
        db,
        CreateTaskRequest {
            title: original.title.clone(),
            parent_type: stored_reference(&item.new_parent_kind).to_string(),
            parent_id: item.new_parent_id.into(),
            status: Some(original.status),
            time_scope: original.time_scope.clone(),
            on_scope_exit: original.on_scope_exit,
            plan: original.plan.clone(),
            // The due is copied with the window it sits in, on the same terms as the Plan.
            due_scope: original.due_scope.clone(),
            // A copy is set aside if the original was. The clone already carries status, plan,
            // privacy, delegate, tags and block reasons — dropping only the Backlog would be the
            // silent discard the confirmation prompts exist to prevent. Safe against the stored
            // invariant `archival = Backlog => plan IS NULL`, because the original satisfies it
            // and both fields are copied from it together.
            archival: Some(original.archival),
            // A copy is agentic if the original was, explicitly not agentic if the original said
            // so, and inheriting if the original inherited — all three states copy, because all
            // three are things the user may have said.
            agentic: Some(TaskAgentic::from_column(original.agentic)),
            // A copy starts the same wait the original starts: the flag describes the action, and
            // the copy is the same action. Dropping it would be the same silent discard.
            asynchronous: Some(original.asynchronous),
            // A copy consists of its sub-items if the original did: its status is the one thing
            // the flag decides, and the copied subtree is what it reads.
            compound: Some(original.compound),
            async_template: original.async_template.clone(),
            agentic_brief: original.agentic_brief.clone(),
        },
    )
    .await?;
    let created_id = created.id.require_stored()?;
    crate::tasks::update_task(
        db,
        TaskId(created_id),
        UpdateTaskRequest {
            position: Some(item.forced_position.unwrap_or(original.position)),
            is_private: Some(original.is_private),
            delegate_to: Some(original.delegate_to),
            ..Default::default()
        },
    )
    .await?;
    for tag_id in &original.tag_ids {
        db.tasks().add_tag(TaskId(created_id), *tag_id).await?;
    }
    carry_block_reasons(db, "task", item.old_id, created_id).await?;
    // The copy waits on the same things the original waits on — see the module docs on why these
    // are not remapped onto copies of their targets.
    for dependency in db.tasks().list_dependencies(TaskId(item.old_id)).await? {
        crate::tasks::add_task_dependency(db, TaskId(created_id), dependency).await?;
    }
    Ok(ClonedNode {
        new_id: created_id,
        kind: "task".to_string(),
    })
}

/// Clones a Commitment row as stored — verdict included, as a copied Task keeps its status — with
/// its tags. A Commitment has no dependencies of its own to carry.
async fn clone_commitment(
    db: &mut Db<Transactional>,
    item: &PendingClone,
) -> Result<ClonedNode, AppError> {
    let created_id = db
        .commitments()
        .copy_row(
            CommitmentId(item.old_id),
            stored_reference(&item.new_parent_kind),
            item.new_parent_id,
        )
        .await?;
    Ok(ClonedNode {
        new_id: created_id,
        kind: "commitment".to_string(),
    })
}

/// Clones a wait row as stored — status, archive, its checks and its agent fields — with its
/// tags. A wait has no dependencies of its own; a Task that waits on it keeps waiting on the
/// original, as every copied dependency does.
async fn clone_expectation(
    db: &mut Db<Transactional>,
    item: &PendingClone,
) -> Result<ClonedNode, AppError> {
    let created_id = db
        .expectations()
        .copy_row(
            ExpectationId(item.old_id),
            stored_reference(&item.new_parent_kind),
            item.new_parent_id,
        )
        .await?;
    Ok(ClonedNode {
        new_id: created_id,
        kind: "expectation".to_string(),
    })
}

/// Clones an info row.
async fn clone_info(
    db: &mut Db<Transactional>,
    item: &PendingClone,
) -> Result<ClonedNode, AppError> {
    let original = db.infos().get(InfoId(item.old_id)).await?;
    let created = db
        .infos()
        .create(CreateInfoRequest {
            body: original.body.clone(),
            details: original.details.clone(),
            parent_type: stored_reference(&item.new_parent_kind).to_string(),
            parent_id: item.new_parent_id.into(),
            position: item.forced_position.unwrap_or(original.position),
        })
        .await?;
    if original.is_private {
        db.infos()
            .update(
                InfoId(created.id),
                UpdateInfoRequest {
                    is_private: Some(true),
                    ..Default::default()
                },
            )
            .await?;
    }
    Ok(ClonedNode {
        new_id: created.id,
        kind: "info".to_string(),
    })
}

/// Copies an owner's ordered block reasons onto its clone.
async fn carry_block_reasons(
    db: &mut Db<Transactional>,
    owner_type: &str,
    old_id: i64,
    new_id: i64,
) -> Result<(), AppError> {
    let reasons = db.block_reasons().list_for(owner_type, old_id).await?;
    if reasons.is_empty() {
        return Ok(());
    }
    db.block_reasons().set(owner_type, new_id, &reasons).await?;
    Ok(())
}
