//! Writes through the virtual tables: one request, routed by the id it names.
//!
//! A request naming a stored row goes where it always went. A request naming a derived row — a
//! Habit occurrence — is resolved to the occurrence's value key and applied to its overlay
//! ([`crate::flows::occurrence_edit`]), and the row comes back as the virtual table now serves it.
//! Neither the caller nor the request knows the difference: that is the whole of ADR 0008's
//! "the normal editor sends a normal update request for either".

use chrono::NaiveDateTime;

use super::{
    id::{DerivedId, NodeId},
    key::{DerivedKey, OccurrenceKey},
    relations::Endpoint,
    table::{resolve_key, resolve_occurrence},
    wait_edit,
};
use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    flows::{
        error::FlowError,
        model::UnfinishedChild,
        occurrence_edit::{self, OccurrenceHost},
    },
    infos::model::{CreateInfoRequest, Info, InfoId, UpdateInfoRequest},
    tasks::{
        error::TaskError,
        model::{
            Commitment, CommitmentId, CreateCommitmentRequest, CreateExpectationRequest,
            CreateGoalRequest, CreateTaskRequest, Dependency, Expectation, ExpectationId, Goal,
            GoalId, Task, TaskDependencyEdge, TaskId, UpdateCommitmentRequest,
            UpdateExpectationRequest, UpdateGoalRequest, UpdateTaskRequest,
        },
    },
};

/// The occurrence `key` names was derived, but not as the kind the caller asked for.
fn wrong_kind(id: &NodeId, kind: &str) -> AppError {
    FlowError::Refused(format!("node {id} is not a {kind}")).into()
}

/// The occurrence a derived parent names, and the host a node hung on it is written under.
async fn occurrence_parent(
    db: &mut Db<Transactional>,
    parent: &DerivedId,
    now: NaiveDateTime,
) -> Result<(OccurrenceKey, OccurrenceHost), AppError> {
    let key = resolve_occurrence(db, parent, now).await?;
    let host = occurrence_edit::host_of(db, &key).await?;
    Ok((key, host))
}

/// A stored row, hung on an occurrence, read as the occurrence's child.
fn hung_on(host: &OccurrenceHost, key: &OccurrenceKey) -> (String, NodeId) {
    (host.parent_kind.to_string(), NodeId::Derived(key.id()))
}

/// Creates a Task under its parent — which may be a Habit occurrence, in which case the Task is
/// written under the Habit's host and attached to the occurrence.
#[tracing::instrument(skip(db, request))]
pub async fn create_task(
    db: &mut Db<Transactional>,
    mut request: CreateTaskRequest,
    now: NaiveDateTime,
) -> Result<Task, AppError> {
    let NodeId::Derived(parent) = request.parent_id.clone() else {
        return Ok(crate::tasks::create_task(db, request).await?);
    };
    let (key, host) = occurrence_parent(db, &parent, now).await?;
    occurrence_edit::check_within(&host, request.time_scope.as_ref(), request.plan.as_ref())?;
    request.parent_type = host.host_type.clone();
    request.parent_id = NodeId::Stored(host.host_id);
    let mut task = crate::tasks::create_task(db, request).await?;
    occurrence_edit::attach(db, &host, &key, "task", task.id.require_stored()?).await?;
    (task.parent_type, task.parent_id) = hung_on(&host, &key);
    Ok(task)
}

/// Creates a Goal under its parent, which may be a Habit occurrence.
#[tracing::instrument(skip(db, request))]
pub async fn create_goal(
    db: &mut Db<Transactional>,
    mut request: CreateGoalRequest,
    now: NaiveDateTime,
) -> Result<Goal, AppError> {
    let NodeId::Derived(parent) = request.parent_id.clone() else {
        return Ok(crate::tasks::create_goal(db, request).await?);
    };
    let (key, host) = occurrence_parent(db, &parent, now).await?;
    occurrence_edit::check_within(&host, request.time_scope.as_ref(), None)?;
    request.parent_type = host.host_type.clone();
    request.parent_id = NodeId::Stored(host.host_id);
    let mut goal = crate::tasks::create_goal(db, request).await?;
    occurrence_edit::attach(db, &host, &key, "goal", goal.id.require_stored()?).await?;
    (goal.parent_type, goal.parent_id) = hung_on(&host, &key);
    Ok(goal)
}

/// Creates a Commitment under its parent, which may be a Habit occurrence. One hung on an
/// occurrence with no window of its own is given the occurrence's: a Commitment with no effective
/// window has nothing to be kept or broken over.
#[tracing::instrument(skip(db, request))]
pub async fn create_commitment(
    db: &mut Db<Transactional>,
    mut request: CreateCommitmentRequest,
    now: NaiveDateTime,
) -> Result<Commitment, AppError> {
    let NodeId::Derived(parent) = request.parent_id.clone() else {
        return Ok(crate::tasks::create_commitment(db, request).await?);
    };
    let (key, host) = occurrence_parent(db, &parent, now).await?;
    occurrence_edit::check_within(&host, request.time_scope.as_ref(), None)?;
    request.parent_type = host.host_type.clone();
    request.parent_id = NodeId::Stored(host.host_id);
    if request.time_scope.is_none() {
        request.time_scope = Some(host.window.clone());
    }
    let mut commitment = crate::tasks::create_commitment(db, request).await?;
    occurrence_edit::attach(
        db,
        &host,
        &key,
        "commitment",
        commitment.id.require_stored()?,
    )
    .await?;
    (commitment.parent_type, commitment.parent_id) = hung_on(&host, &key);
    Ok(commitment)
}

/// Creates an Expectation under its parent, which may be a Habit occurrence.
#[tracing::instrument(skip(db, request))]
pub async fn create_expectation(
    db: &mut Db<Transactional>,
    mut request: CreateExpectationRequest,
    now: NaiveDateTime,
) -> Result<Expectation, AppError> {
    let NodeId::Derived(parent) = request.parent_id.clone() else {
        return Ok(crate::tasks::create_expectation(db, request).await?);
    };
    let (key, host) = occurrence_parent(db, &parent, now).await?;
    occurrence_edit::check_within(&host, request.time_scope.as_ref(), None)?;
    request.parent_type = host.host_type.clone();
    request.parent_id = NodeId::Stored(host.host_id);
    let mut expectation = crate::tasks::create_expectation(db, request).await?;
    occurrence_edit::attach(
        db,
        &host,
        &key,
        "expectation",
        expectation.id.require_stored()?,
    )
    .await?;
    (expectation.parent_type, expectation.parent_id) = hung_on(&host, &key);
    Ok(expectation)
}

/// Creates a note under its parent, which may be a Habit occurrence.
#[tracing::instrument(skip(db, request))]
pub async fn create_info(
    db: &mut Db<Transactional>,
    mut request: CreateInfoRequest,
    now: NaiveDateTime,
) -> Result<Info, AppError> {
    let NodeId::Derived(parent) = request.parent_id.clone() else {
        return Ok(db.infos().create(request).await?);
    };
    let (key, host) = occurrence_parent(db, &parent, now).await?;
    request.parent_type = host.host_type.clone();
    request.parent_id = NodeId::Stored(host.host_id);
    let mut info = db.infos().create(request).await?;
    occurrence_edit::attach(db, &host, &key, "info", info.id).await?;
    (info.parent_type, info.parent_id) = hung_on(&host, &key);
    Ok(info)
}

/// Moves a stored row: a new parent that is an occurrence is resolved to the Habit's host and
/// returned, to be attached once the row's own write has landed; a new stored parent takes the
/// row off any occurrence it hung on.
async fn move_stored(
    db: &mut Db<Transactional>,
    child_type: &str,
    child_id: i64,
    parent_type: &mut Option<String>,
    parent_id: &mut Option<NodeId>,
    now: NaiveDateTime,
) -> Result<Option<(OccurrenceKey, OccurrenceHost)>, AppError> {
    match parent_id.clone() {
        Some(NodeId::Derived(parent)) => {
            let (key, host) = occurrence_parent(db, &parent, now).await?;
            *parent_type = Some(host.host_type.clone());
            *parent_id = Some(NodeId::Stored(host.host_id));
            Ok(Some((key, host)))
        }
        Some(NodeId::Stored(_)) => {
            db.flows()
                .detach_instance_child(child_type, child_id)
                .await?;
            Ok(None)
        }
        None => Ok(None),
    }
}

/// Finishes a move [`move_stored`] began: attaches the row to the occurrence it was moved onto.
async fn finish_move(
    db: &mut Db<Transactional>,
    moved: Option<(OccurrenceKey, OccurrenceHost)>,
    child_type: &str,
    child_id: i64,
) -> Result<Option<(String, NodeId)>, AppError> {
    let Some((key, host)) = moved else {
        return Ok(None);
    };
    occurrence_edit::attach(db, &host, &key, child_type, child_id).await?;
    Ok(Some(hung_on(&host, &key)))
}

/// Updates a Task, stored or derived. A stored Task moved onto a Habit occurrence is hung on it.
#[tracing::instrument(skip(db, request))]
pub async fn update_task(
    db: &mut Db<Transactional>,
    id: &NodeId,
    mut request: UpdateTaskRequest,
    now: NaiveDateTime,
) -> Result<Task, AppError> {
    let derived = match id {
        NodeId::Stored(id) => {
            let moved = move_stored(
                db,
                "task",
                *id,
                &mut request.parent_type,
                &mut request.parent_id,
                now,
            )
            .await?;
            if let Some((_, host)) = &moved {
                occurrence_edit::check_within(
                    host,
                    request.time_scope.as_ref().and_then(Option::as_ref),
                    request.plan.as_ref().and_then(Option::as_ref),
                )?;
            }
            let mut task = crate::tasks::update_task(db, TaskId(*id), request).await?;
            if let Some((parent_type, parent_id)) = finish_move(db, moved, "task", *id).await? {
                (task.parent_type, task.parent_id) = (parent_type, parent_id);
            }
            return Ok(task);
        }
        NodeId::Derived(derived) => derived,
    };
    let key = match resolve_key(db, derived, now).await? {
        DerivedKey::Occurrence(key) => key,
        DerivedKey::Check(check) => {
            wait_edit::update_check_task(db, &check, request, now).await?;
            return wait_edit::check_row(db, &check, now).await;
        }
        _ => return Err(wrong_kind(id, "task")),
    };
    occurrence_edit::update_task(db, &key, request, now).await?;
    match occurrence_edit::occurrence_row(db, &key, now).await? {
        (Some(task), _, _) => Ok(task),
        _ => Err(wrong_kind(id, "task")),
    }
}

/// Updates a Goal, stored or derived. A stored Goal moved onto a Habit occurrence is hung on it.
#[tracing::instrument(skip(db, request))]
pub async fn update_goal(
    db: &mut Db<Transactional>,
    id: &NodeId,
    mut request: UpdateGoalRequest,
    now: NaiveDateTime,
) -> Result<Goal, AppError> {
    let derived = match id {
        NodeId::Stored(id) => {
            let moved = move_stored(
                db,
                "goal",
                *id,
                &mut request.parent_type,
                &mut request.parent_id,
                now,
            )
            .await?;
            let mut goal = crate::tasks::update_goal(db, GoalId(*id), request).await?;
            if let Some((parent_type, parent_id)) = finish_move(db, moved, "goal", *id).await? {
                (goal.parent_type, goal.parent_id) = (parent_type, parent_id);
            }
            return Ok(goal);
        }
        NodeId::Derived(derived) => derived,
    };
    let key = resolve_occurrence(db, derived, now).await?;
    occurrence_edit::update_goal(db, &key, request, now).await?;
    match occurrence_edit::occurrence_row(db, &key, now).await? {
        (_, Some(goal), _) => Ok(goal),
        _ => Err(wrong_kind(id, "goal")),
    }
}

/// Updates a Commitment, stored or derived — including recording its Verdict. A stored one moved
/// onto a Habit occurrence is hung on it.
#[tracing::instrument(skip(db, request))]
pub async fn update_commitment(
    db: &mut Db<Transactional>,
    id: &NodeId,
    mut request: UpdateCommitmentRequest,
    now: NaiveDateTime,
) -> Result<Commitment, AppError> {
    let derived = match id {
        NodeId::Stored(id) => {
            let moved = move_stored(
                db,
                "commitment",
                *id,
                &mut request.parent_type,
                &mut request.parent_id,
                now,
            )
            .await?;
            let mut commitment =
                crate::tasks::update_commitment(db, CommitmentId(*id), request).await?;
            if let Some((parent_type, parent_id)) =
                finish_move(db, moved, "commitment", *id).await?
            {
                (commitment.parent_type, commitment.parent_id) = (parent_type, parent_id);
            }
            return Ok(commitment);
        }
        NodeId::Derived(derived) => derived,
    };
    let key = resolve_occurrence(db, derived, now).await?;
    occurrence_edit::update_commitment(db, &key, request, now).await?;
    match occurrence_edit::occurrence_row(db, &key, now).await? {
        (_, _, Some(commitment)) => Ok(commitment),
        _ => Err(wrong_kind(id, "commitment")),
    }
}

/// The nodes hung on an occurrence that are not finished — what completing it would close over.
///
/// A stored node has none to report: the guard belongs to a Habit occurrence, whose added
/// children archive with it when its window passes (see `docs/spec/habits.md`).
pub async fn unfinished_children(
    db: &mut Db<Transactional>,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<Vec<UnfinishedChild>, AppError> {
    let NodeId::Derived(derived) = id else {
        return Ok(Vec::new());
    };
    let DerivedKey::Occurrence(key) = resolve_key(db, derived, now).await? else {
        return Ok(Vec::new());
    };
    Ok(crate::flows::unfinished_instance_children(db, &key).await?)
}

/// Updates an Expectation. A stored one moved onto a Habit occurrence is hung on it; a Task's
/// spawned wait takes its status and archive; a delegated Task's wait takes nothing.
#[tracing::instrument(skip(db, request))]
pub async fn update_expectation(
    db: &mut Db<Transactional>,
    id: &NodeId,
    mut request: UpdateExpectationRequest,
    now: NaiveDateTime,
) -> Result<Expectation, AppError> {
    let id = match id {
        NodeId::Stored(id) => *id,
        NodeId::Derived(derived) => {
            return match resolve_key(db, derived, now).await? {
                DerivedKey::SpawnedWait(task) => {
                    wait_edit::update_spawned_wait(db, &task, request, now).await
                }
                DerivedKey::DelegationWait(_) => Err(wait_edit::refuse_delegation_wait()),
                _ => Err(wrong_kind(&NodeId::Derived(derived.clone()), "expectation")),
            };
        }
    };
    let moved = move_stored(
        db,
        "expectation",
        id,
        &mut request.parent_type,
        &mut request.parent_id,
        now,
    )
    .await?;
    let mut expectation = crate::tasks::update_expectation(db, ExpectationId(id), request).await?;
    if let Some((parent_type, parent_id)) = finish_move(db, moved, "expectation", id).await? {
        (expectation.parent_type, expectation.parent_id) = (parent_type, parent_id);
    }
    Ok(expectation)
}

/// Updates a note, which is always stored; one moved onto a Habit occurrence is hung on it.
#[tracing::instrument(skip(db, request))]
pub async fn update_info(
    db: &mut Db<Transactional>,
    id: i64,
    mut request: UpdateInfoRequest,
    now: NaiveDateTime,
) -> Result<Info, AppError> {
    let moved = move_stored(
        db,
        "info",
        id,
        &mut request.parent_type,
        &mut request.parent_id,
        now,
    )
    .await?;
    let mut info = db.infos().update(InfoId(id), request).await?;
    if let Some((parent_type, parent_id)) = finish_move(db, moved, "info", id).await? {
        (info.parent_type, info.parent_id) = (parent_type, parent_id);
    }
    Ok(info)
}

/// Puts a tag on (`present`) or takes one off a node of any taggable kind. On a derived node it is
/// recorded as a difference against its template's tags.
#[tracing::instrument(skip(db))]
pub async fn set_tag(
    db: &mut Db<Transactional>,
    kind: &str,
    id: &NodeId,
    tag_id: i64,
    present: bool,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let derived = match (kind, id, present) {
        ("goal", NodeId::Stored(id), true) => {
            return Ok(db.goals().add_tag(GoalId(*id), tag_id).await?)
        }
        ("goal", NodeId::Stored(id), false) => {
            return Ok(db.goals().remove_tag(GoalId(*id), tag_id).await?)
        }
        ("commitment", NodeId::Stored(id), true) => {
            return Ok(db.commitments().add_tag(CommitmentId(*id), tag_id).await?)
        }
        ("commitment", NodeId::Stored(id), false) => {
            return Ok(db
                .commitments()
                .remove_tag(CommitmentId(*id), tag_id)
                .await?)
        }
        ("expectation", NodeId::Stored(id), true) => {
            return Ok(db
                .expectations()
                .add_tag(ExpectationId(*id), tag_id)
                .await?)
        }
        ("expectation", NodeId::Stored(id), false) => {
            return Ok(db
                .expectations()
                .remove_tag(ExpectationId(*id), tag_id)
                .await?)
        }
        (_, NodeId::Stored(id), true) => {
            return Ok(db.tasks().add_tag(TaskId(*id), tag_id).await?)
        }
        (_, NodeId::Stored(id), false) => {
            return Ok(db.tasks().remove_tag(TaskId(*id), tag_id).await?)
        }
        (_, NodeId::Derived(derived), _) => derived,
    };
    let key = match resolve_key(db, derived, now).await? {
        DerivedKey::Occurrence(key) => key,
        DerivedKey::Check(check) if kind == "task" => {
            // A check task is drawn from its wait, which gives it no tags of its own.
            return Ok(db
                .relations()
                .set_tag(None, "task", &check.node_key(), tag_id, false, present)
                .await?);
        }
        _ => {
            return Err(FlowError::Refused(
                "a derived wait's tags are its Task's Expectation template's".to_string(),
            )
            .into())
        }
    };
    let flow_id = db.flows().occurrence_flow_id(&key).await?;
    let template = occurrence_edit::template_fields(db, &key).await?;
    db.relations()
        .set_tag(
            Some(flow_id.0),
            kind,
            &key.node_key(),
            tag_id,
            template.tag_ids.contains(&tag_id),
            present,
        )
        .await?;
    Ok(())
}

/// Takes a derived row's issue link off that row alone: a Habit occurrence then reads none, even
/// where its template carries one. A wait's check task never carries one, so clearing it is a
/// no-op, as clearing any row with no link is.
#[tracing::instrument(skip(db))]
pub async fn clear_derived_beads_id(
    db: &mut Db<Transactional>,
    node_type: &str,
    id: &DerivedId,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let key = match resolve_key(db, id, now).await? {
        DerivedKey::Occurrence(key) => key,
        DerivedKey::Check(_) => return Ok(()),
        _ => return Err(wrong_kind(&NodeId::Derived(id.clone()), node_type)),
    };
    let flow_id = db.flows().occurrence_flow_id(&key).await?.0;
    // Set to NULL when the template has a link to override; otherwise the row already reads none.
    let overrides = occurrence_edit::template_fields(db, &key)
        .await?
        .beads_id
        .is_some();
    match node_type {
        "task" => {
            let mut overlay = db.overlays().task(&key).await?;
            (overlay.beads_id, overlay.beads_id_set) = (None, overrides);
            db.overlays().put_task(flow_id, &key, &overlay).await?;
        }
        "goal" => {
            let mut overlay = db.overlays().goal(&key).await?;
            (overlay.beads_id, overlay.beads_id_set) = (None, overrides);
            db.overlays().put_goal(flow_id, &key, &overlay).await?;
        }
        "commitment" => {
            let mut overlay = db.overlays().commitment(&key).await?;
            (overlay.beads_id, overlay.beads_id_set) = (None, overrides);
            db.overlays()
                .put_commitment(flow_id, &key, &overlay)
                .await?;
        }
        other => return Err(wrong_kind(&NodeId::Derived(id.clone()), other)),
    }
    Ok(())
}

/// Replaces a Task's or Goal's block reasons. A derived one's list is its own until it is set back
/// to its template's, which it then reads again.
#[tracing::instrument(skip(db, reasons))]
pub async fn set_block_reasons(
    db: &mut Db<Transactional>,
    owner_type: &str,
    owner_id: &NodeId,
    reasons: &[String],
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let derived = match owner_id {
        NodeId::Stored(id) => return Ok(db.block_reasons().set(owner_type, *id, reasons).await?),
        NodeId::Derived(derived) => derived,
    };
    let key = match resolve_key(db, derived, now).await? {
        DerivedKey::Occurrence(key) => key,
        DerivedKey::Check(check) => {
            // A check task's list is its own once it has any; its wait gives it none.
            let own = !reasons.is_empty();
            db.relations()
                .set_block_reasons(None, "task", &check.node_key(), own.then_some(reasons))
                .await?;
            let mut overlay = db.overlays().check_task(&check).await?;
            overlay.block_reasons_set = own;
            db.overlays().put_check_task(&check, &overlay).await?;
            return Ok(());
        }
        _ => return Err(wrong_kind(owner_id, owner_type)),
    };
    let flow_id = db.flows().occurrence_flow_id(&key).await?;
    let template = occurrence_edit::template_fields(db, &key).await?;
    let own = reasons != template.block_reasons.as_slice();
    db.relations()
        .set_block_reasons(
            Some(flow_id.0),
            owner_type,
            &key.node_key(),
            own.then_some(reasons),
        )
        .await?;
    if owner_type == "goal" {
        let mut overlay = db.overlays().goal(&key).await?;
        overlay.block_reasons_set = own;
        db.overlays().put_goal(flow_id.0, &key, &overlay).await?;
    } else {
        let mut overlay = db.overlays().task(&key).await?;
        overlay.block_reasons_set = own;
        db.overlays().put_task(flow_id.0, &key, &overlay).await?;
    }
    Ok(())
}

/// One end of an edge being written, and the Habit it belongs to when it is derived.
async fn endpoint(
    db: &mut Db<Transactional>,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<(Endpoint, Option<i64>), AppError> {
    match id {
        NodeId::Stored(id) => Ok((Endpoint::Stored(*id), None)),
        NodeId::Derived(derived) => match resolve_key(db, derived, now).await? {
            DerivedKey::Occurrence(key) => {
                let flow_id = db.flows().occurrence_flow_id(&key).await?;
                Ok((Endpoint::Derived(key.node_key()), Some(flow_id.0)))
            }
            DerivedKey::Check(check) => Ok((Endpoint::Derived(check.node_key()), None)),
            _ => Err(FlowError::Refused(
                "a derived wait cannot be depended on; depend on its Task instead".to_string(),
            )
            .into()),
        },
    }
}

/// The dependency edges the board carries now, stored and derived alike.
async fn effective_edges(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
) -> Result<Vec<TaskDependencyEdge>, AppError> {
    Ok(crate::mindmap::load(db, now).await?.task_dependencies)
}

/// Every dependency edge on the board now, stored and derived alike — a template's edges drawn
/// between the occurrences of one iteration, less the ones an occurrence removed, plus the ones
/// added by hand.
pub async fn all_dependencies(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
) -> Result<Vec<TaskDependencyEdge>, AppError> {
    effective_edges(db, now).await
}

/// What one Task depends on now, stored or derived.
pub async fn dependencies_of(
    db: &mut Db<Transactional>,
    task_id: &NodeId,
    now: NaiveDateTime,
) -> Result<Vec<Dependency>, AppError> {
    Ok(effective_edges(db, now)
        .await?
        .into_iter()
        .filter(|edge| &edge.task_id == task_id)
        .filter_map(|edge| dependency_of(edge.dependency_type.as_str(), edge.dependency_id))
        .collect())
}

/// The request shape of one edge's target.
fn dependency_of(target_type: &str, id: NodeId) -> Option<Dependency> {
    match (target_type, id) {
        ("task", id) => Some(Dependency::Task { id }),
        ("goal", id) => Some(Dependency::Goal { id }),
        ("expectation", NodeId::Stored(id)) => Some(Dependency::Expectation { id }),
        _ => None,
    }
}

/// Whether `dependent` would reach itself through `target` once the edge is added.
fn closes_a_cycle(edges: &[TaskDependencyEdge], dependent: &NodeId, target: &NodeId) -> bool {
    let mut stack = vec![target.clone()];
    let mut seen: std::collections::HashSet<NodeId> = std::collections::HashSet::new();
    while let Some(node) = stack.pop() {
        if &node == dependent {
            return true;
        }
        if !seen.insert(node.clone()) {
            continue;
        }
        stack.extend(
            edges
                .iter()
                .filter(|edge| edge.task_id == node && edge.dependency_type == "task")
                .map(|edge| edge.dependency_id.clone()),
        );
    }
    false
}

/// The edge a dependency request names, as its dependent, its target's kind and its target.
fn target_of(dependency: &Dependency) -> (&'static str, NodeId) {
    match dependency {
        Dependency::Task { id } => ("task", id.clone()),
        Dependency::Goal { id } => ("goal", id.clone()),
        Dependency::Expectation { id } => ("expectation", NodeId::Stored(*id)),
    }
}

/// Makes a Task depend on something, either end of which may be derived. An edge between two
/// stored rows is an ordinary `task_dependencies` row; any other is recorded as a difference —
/// or, for an edge the template already draws that an occurrence had removed, the removal is
/// taken back.
#[tracing::instrument(skip(db))]
pub async fn add_dependency(
    db: &mut Db<Transactional>,
    task_id: &NodeId,
    dependency: Dependency,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let (target_type, target) = target_of(&dependency);
    if let (NodeId::Stored(id), NodeId::Stored(_)) = (task_id, &target) {
        return Ok(crate::tasks::add_task_dependency(db, TaskId(*id), dependency).await?);
    }
    let edges = effective_edges(db, now).await?;
    if target_type == "task" && closes_a_cycle(&edges, task_id, &target) {
        return Err(TaskError::CircularDependency.into());
    }
    let (dependent, dependent_flow) = endpoint(db, task_id, now).await?;
    let (target_end, target_flow) = endpoint(db, &target, now).await?;
    db.relations()
        .clear_dependency(&dependent, target_type, &target_end)
        .await?;
    let drawn = effective_edges(db, now).await?.iter().any(|edge| {
        &edge.task_id == task_id
            && edge.dependency_type == target_type
            && edge.dependency_id == target
    });
    if drawn {
        return Ok(());
    }
    db.relations()
        .put_dependency(
            dependent_flow.or(target_flow),
            &dependent,
            target_type,
            &target_end,
            true,
        )
        .await?;
    Ok(())
}

/// Takes a dependency off a Task, either end of which may be derived: an added edge is forgotten,
/// and one the template draws is recorded as removed from this occurrence.
#[tracing::instrument(skip(db))]
pub async fn remove_dependency(
    db: &mut Db<Transactional>,
    task_id: &NodeId,
    dependency: Dependency,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let (target_type, target) = target_of(&dependency);
    if let (NodeId::Stored(id), NodeId::Stored(_)) = (task_id, &target) {
        return Ok(db
            .tasks()
            .remove_dependency(TaskId(*id), dependency)
            .await?);
    }
    let (dependent, dependent_flow) = endpoint(db, task_id, now).await?;
    let (target_end, target_flow) = endpoint(db, &target, now).await?;
    db.relations()
        .clear_dependency(&dependent, target_type, &target_end)
        .await?;
    let still_drawn = effective_edges(db, now).await?.iter().any(|edge| {
        &edge.task_id == task_id
            && edge.dependency_type == target_type
            && edge.dependency_id == target
    });
    if still_drawn {
        db.relations()
            .put_dependency(
                dependent_flow.or(target_flow),
                &dependent,
                target_type,
                &target_end,
                false,
            )
            .await?;
    }
    Ok(())
}

/// Deletes a node of any of the three kinds — or, for a derived one, **archives** it: an
/// occurrence is never deleted (ADR 0008, decision 7).
#[tracing::instrument(skip(db))]
pub async fn delete(
    db: &mut Db<Transactional>,
    kind: &str,
    id: &NodeId,
    now: NaiveDateTime,
) -> Result<(), AppError> {
    let derived = match (kind, id) {
        ("goal", NodeId::Stored(id)) => {
            return Ok(crate::tasks::delete_goal(db, GoalId(*id)).await?)
        }
        ("commitment", NodeId::Stored(id)) => {
            return Ok(crate::tasks::delete_commitment(db, CommitmentId(*id)).await?)
        }
        (_, NodeId::Stored(id)) => return Ok(crate::tasks::delete_task(db, TaskId(*id)).await?),
        (_, NodeId::Derived(derived)) => derived,
    };
    let DerivedKey::Occurrence(key) = resolve_key(db, derived, now).await? else {
        return Err(FlowError::Refused(
            "a wait's check task or derived wait is not deleted; it goes with its wait or Task"
                .to_string(),
        )
        .into());
    };
    occurrence_edit::archive(db, &key).await?;
    Ok(())
}
