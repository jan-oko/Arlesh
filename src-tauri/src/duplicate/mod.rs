//! Cross-domain subtree duplication, backing the Mindmap's Copy+Paste.
//!
//! Cut and Copy are the same gesture up to one question — does the original survive? — and the
//! backend answered only the first of them. A reparent is one `UPDATE`; a copy has no existing
//! row to move, so it needs a traversal of its own, and this is it.
//!
//! A node's children can live in any of the `domains`/`goals`/`tasks`/`infos` tables, keyed by a
//! polymorphic `(parent_type, parent_id)` pair with no foreign key to walk. So the clone is a
//! breadth-first pass: each node is cloned under its already-cloned new parent, and its children
//! are discovered only once that parent's new id exists. Everything the node holds — status,
//! tags, block reasons, Time Scope, on-exit behaviour, Plan, delegate, privacy, position,
//! dependencies and its `beads_id` — is copied with it.
//!
//! Two things deliberately do **not** happen here:
//!
//! - **Dependencies are not remapped.** A copied task waits on exactly what the original waits
//!   on, even when that target was itself copied. That is what a plain reparent does, and it is
//!   the conservative reading; Flow instances solve the same problem the other way, by remapping
//!   per instance (ADR 0002), and that is the model to reach for if this proves wrong.
//! - **Flows are not traversed.** A Flow hanging under a copied node is not copied. Copying a Flow
//!   on its own is `flows::duplicate_flow`, which answers what a copy of a Recurrence and of a
//!   completion history means; wiring this walk to call it for each Flow under a copied node is
//!   the piece still missing, and all that is missing. Until it lands, the Mindmap's paste walks
//!   the copied subtree itself and **names** the Flows this walk will not carry, so the gap is
//!   said out loud rather than leaving a paste smaller than the copy with nothing to show for it.
//!
//! Aspects are never duplicated: they are the fixed, seeded roots of the board.
//!
//! The whole walk runs on the caller's transactional session and never opens one of its own, per
//! ADR 0004 — so a failure part-way leaves the tree exactly as it was, rather than half a subtree.

use std::collections::VecDeque;

use crate::database::session::{Db, Transactional};
use crate::domains::error::DomainError;
use crate::domains::model::{
    CreateDomainRequest, DomainId, DomainSubtype, ProjectStatus, UpdateDomainRequest,
};
use crate::error::AppError;
use crate::infos::model::{CreateInfoRequest, InfoId, UpdateInfoRequest};
use crate::tasks::model::{
    CreateGoalRequest, CreateTaskRequest, GoalId, GoalStatus, TaskAgentic, TaskId, TaskStatus,
    UpdateGoalRequest, UpdateTaskRequest,
};

/// A node kind this module can clone — one per table a Mindmap subtree spans.
///
/// The `domains` subtype (Project, Domain or Tag) is read off the row itself and carried over
/// unchanged, so a single [`Domain`](Self::Domain) variant covers all three. Aspects are absent
/// on purpose, and so are Flows and flow items: see the module docs.
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
/// new root at `position`, and returns the new root's id.
///
/// `target_kind` is the target's kind as the *root's own table* spells a parent: `"project"`,
/// `"goal"` or `"task"` for a goal or task root, the target's exact subtype for an info root, and
/// unused for a domain root (the `domains` table has only a `parent_id`).
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
) -> Result<i64, AppError> {
    let root = PendingClone {
        kind,
        old_id: id,
        new_parent_kind: target_kind.to_string(),
        new_parent_id: target_id,
        forced_position: Some(position),
    };
    let cloned_root = clone_node(db, &root).await?;
    let mut queue: VecDeque<PendingClone> = children_of(db, &root, &cloned_root).await?.into();
    while let Some(item) = queue.pop_front() {
        let cloned = clone_node(db, &item).await?;
        queue.extend(children_of(db, &item, &cloned).await?);
    }
    Ok(cloned_root.new_id)
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
    }
}

/// The direct children of a just-cloned node, each already pointed at its new parent.
///
/// `cloned.kind` doubles as the source node's own kind spelling — a clone keeps its subtype — so
/// one string serves both the `SELECT` against the original and the `parent_type` the copies get.
async fn children_of(
    db: &mut Db<Transactional>,
    item: &PendingClone,
    cloned: &ClonedNode,
) -> Result<Vec<PendingClone>, AppError> {
    let old_id = item.old_id;
    let mut children: Vec<(DuplicableKind, i64)> = Vec::new();
    match item.kind {
        DuplicableKind::Domain => {
            // A goal or task under any domains-table row records `parent_type = 'project'`,
            // whatever the parent's real subtype is; an info records the exact subtype.
            extend(
                &mut children,
                DuplicableKind::Domain,
                db.domains().child_ids(DomainId(old_id)).await?,
            );
            extend(
                &mut children,
                DuplicableKind::Goal,
                db.goals().child_ids("project", old_id).await?,
            );
            extend(
                &mut children,
                DuplicableKind::Task,
                db.tasks().child_ids("project", old_id).await?,
            );
            extend(
                &mut children,
                DuplicableKind::Info,
                db.infos().child_ids(&cloned.kind, old_id).await?,
            );
        }
        DuplicableKind::Goal => {
            extend(
                &mut children,
                DuplicableKind::Goal,
                db.goals().child_ids("goal", old_id).await?,
            );
            extend(
                &mut children,
                DuplicableKind::Task,
                db.tasks().child_ids("goal", old_id).await?,
            );
            extend(
                &mut children,
                DuplicableKind::Info,
                db.infos().child_ids("goal", old_id).await?,
            );
        }
        DuplicableKind::Task => {
            extend(
                &mut children,
                DuplicableKind::Task,
                db.tasks().child_ids("task", old_id).await?,
            );
            extend(
                &mut children,
                DuplicableKind::Info,
                db.infos().child_ids("task", old_id).await?,
            );
        }
        DuplicableKind::Info => {
            extend(
                &mut children,
                DuplicableKind::Info,
                db.infos().child_ids("info", old_id).await?,
            );
        }
    }
    Ok(children
        .into_iter()
        .map(|(kind, child_id)| PendingClone {
            kind,
            old_id: child_id,
            new_parent_kind: cloned.kind.clone(),
            new_parent_id: cloned.new_id,
            forced_position: None,
        })
        .collect())
}

/// Tags each id in `ids` with its kind and appends them to `children`.
fn extend(children: &mut Vec<(DuplicableKind, i64)>, kind: DuplicableKind, ids: Vec<i64>) {
    children.extend(ids.into_iter().map(|id| (kind, id)));
}

/// A goal's or task's stored `parent_type`: `"goal"` and `"task"` pass through, and every
/// domains-table kind (aspect, project, domain, tag) collapses to the literal `"project"`, which
/// is the only spelling those two tables' CHECK constraints accept for a domains-table parent.
fn collapse_parent_kind(kind: &str) -> &str {
    if kind == "goal" || kind == "task" {
        kind
    } else {
        "project"
    }
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
    carry_beads_id(db, DuplicableKind::Domain, created.id, original.beads_id).await?;
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
            parent_type: collapse_parent_kind(&item.new_parent_kind).to_string(),
            parent_id: item.new_parent_id,
            status: GoalStatus::from_db(&original.status),
            time_scope: original.time_scope.clone(),
            on_scope_exit: original.on_scope_exit,
        },
    )
    .await?;
    crate::tasks::update_goal(
        db,
        GoalId(created.id),
        UpdateGoalRequest {
            position: Some(item.forced_position.unwrap_or(original.position)),
            is_private: Some(original.is_private),
            ..Default::default()
        },
    )
    .await?;
    for tag_id in &original.tag_ids {
        db.goals().add_tag(GoalId(created.id), *tag_id).await?;
    }
    carry_block_reasons(db, "goal", item.old_id, created.id).await?;
    carry_beads_id(db, DuplicableKind::Goal, created.id, original.beads_id).await?;
    Ok(ClonedNode {
        new_id: created.id,
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
            parent_type: collapse_parent_kind(&item.new_parent_kind).to_string(),
            parent_id: item.new_parent_id,
            status: TaskStatus::from_db(&original.status),
            time_scope: original.time_scope.clone(),
            on_scope_exit: original.on_scope_exit,
            plan: original.plan.clone(),
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
        },
    )
    .await?;
    crate::tasks::update_task(
        db,
        TaskId(created.id),
        UpdateTaskRequest {
            position: Some(item.forced_position.unwrap_or(original.position)),
            is_private: Some(original.is_private),
            delegate_to: Some(original.delegate_to),
            ..Default::default()
        },
    )
    .await?;
    for tag_id in &original.tag_ids {
        db.tasks().add_tag(TaskId(created.id), *tag_id).await?;
    }
    carry_block_reasons(db, "task", item.old_id, created.id).await?;
    // The copy waits on the same things the original waits on — see the module docs on why these
    // are not remapped onto copies of their targets.
    for dependency in db.tasks().list_dependencies(TaskId(item.old_id)).await? {
        crate::tasks::add_task_dependency(db, TaskId(created.id), dependency).await?;
    }
    carry_beads_id(db, DuplicableKind::Task, created.id, original.beads_id).await?;
    Ok(ClonedNode {
        new_id: created.id,
        kind: "task".to_string(),
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
            parent_type: item.new_parent_kind.clone(),
            parent_id: item.new_parent_id,
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

/// Propagates the source's `beads_id` onto its clone, when it has one.
///
/// **The one Tauri-reachable writer of that column**, and a named exception to SPEC's *Beads id*
/// invariant: the MCP server remains the only *source* of a beads id, and duplication only
/// carries an id that already exists. Nothing here can author, edit or clear one — a source with
/// no link produces a copy with no link, which is why this returns early rather than writing a
/// `NULL`.
async fn carry_beads_id(
    db: &mut Db<Transactional>,
    kind: DuplicableKind,
    new_id: i64,
    beads_id: Option<String>,
) -> Result<(), AppError> {
    if beads_id.is_none() {
        return Ok(());
    }
    match kind {
        DuplicableKind::Domain => {
            db.domains()
                .set_beads_id(DomainId(new_id), beads_id)
                .await?
        }
        DuplicableKind::Goal => db.goals().set_beads_id(GoalId(new_id), beads_id).await?,
        DuplicableKind::Task => db.tasks().set_beads_id(TaskId(new_id), beads_id).await?,
        // Infos carry no issue link — there is no column to write.
        DuplicableKind::Info => {}
    }
    Ok(())
}
