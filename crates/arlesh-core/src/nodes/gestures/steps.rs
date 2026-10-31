//! The writes a gesture is made of, run in order inside the gesture's one transaction.
//!
//! A gesture operation (see the parent module) is a named list of these steps. A step that makes a
//! node can be named by a later one as `{"step": n}`, which is how *insert parent* moves a node
//! under the parent it has just created, and how an editor's Save writes the tags of the Flow it
//! has just forked. Each step's answer comes back in order, so the caller reads what was made.

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    database::session::{Db, Transactional},
    domains::model::{CreateDomainRequest, DomainId, UpdateDomainRequest},
    duplicate::{duplicate_subtree, DuplicableKind},
    error::WireError,
    flows::{
        self,
        cycles::Reconcile,
        model::{
            CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowId, FlowItemType,
            SetRecurrenceRequest, UpdateFlowItemRequest, UpdateFlowRequest,
        },
    },
    infos::model::{CreateInfoRequest, UpdateInfoRequest},
    nodes::{composite, id::NodeId, write},
    tasks::model::{
        CreateCommitmentRequest, CreateExpectationRequest, CreateGoalRequest, CreateTaskRequest,
        Dependency, DescendantPlans, TaskId, UpdateCommitmentRequest, UpdateExpectationRequest,
        UpdateGoalRequest, UpdateSpawnedWaitRequest, UpdateTaskRequest,
    },
};

use super::GestureNode;

/// A node a step acts on: an id, or the node an earlier step of the same gesture made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum StepTarget {
    /// The node that replaces `id` in the Habit an earlier step forked — `forked` names its kind
    /// (`flow`, or a Flow item kind) — or `id` itself when that step forked nothing.
    Forked {
        /// The earlier step: one that sets a Flow item's cycles.
        step: usize,
        /// `flow`, `flow_goal`, `flow_task`, `flow_commitment` or `flow_expectation`.
        forked: String,
        /// The node in the Habit as it was.
        id: i64,
    },
    /// The node made by step `step` (counting from 0) of this gesture.
    Made {
        /// The earlier step's index.
        step: usize,
    },
    /// A node by its id.
    Id(NodeId),
}

/// One write of a gesture. Read from a request, never written.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum GestureStep {
    /// Moves a node under a new parent at `position`: its parent link is rewritten as its own
    /// update would rewrite it.
    Move {
        /// The node's kind.
        kind: String,
        /// The node.
        id: StepTarget,
        /// The new parent's kind.
        parent_kind: String,
        /// The new parent.
        parent: StepTarget,
        /// Where among the new parent's children.
        position: i64,
    },
    /// Copies a node's subtree under a parent. Answers the copy's id and what it left behind.
    Duplicate {
        /// The node's kind.
        kind: String,
        /// The node's row id.
        id: i64,
        /// The parent's kind.
        parent_kind: String,
        /// The parent's row id.
        parent_id: i64,
        /// Where among the parent's children.
        position: i64,
    },
    /// Deletes a node.
    Delete {
        /// The node.
        node: GestureNode,
    },
    /// Creates a Task.
    CreateTask {
        /// What to create.
        request: CreateTaskRequest,
    },
    /// Creates a Goal.
    CreateGoal {
        /// What to create.
        request: CreateGoalRequest,
    },
    /// Creates a Commitment.
    CreateCommitment {
        /// What to create.
        request: CreateCommitmentRequest,
    },
    /// Creates a wait.
    CreateExpectation {
        /// What to create.
        request: CreateExpectationRequest,
    },
    /// Creates an Info.
    CreateInfo {
        /// What to create.
        request: CreateInfoRequest,
    },
    /// Creates a Domain, Project or Tag.
    CreateDomain {
        /// What to create.
        request: CreateDomainRequest,
    },
    /// Creates a Flow.
    CreateFlow {
        /// What to create.
        request: CreateFlowRequest,
    },
    /// Creates a Flow item.
    CreateFlowItem {
        /// Which kind of item.
        item_type: FlowItemType,
        /// What to create.
        request: CreateFlowItemRequest,
    },
    /// Updates a Task, settling the Plans below as `descendant_plans` says when it is given.
    UpdateTask {
        /// The Task.
        id: StepTarget,
        /// What to change.
        request: UpdateTaskRequest,
        /// Completing a Habit occurrence over unfinished children asks first unless this is set.
        #[serde(default)]
        confirmed: bool,
        /// What becomes of the Tasks below whose own Plan the new Plan would leave outside.
        #[serde(default)]
        descendant_plans: Option<DescendantPlans>,
    },
    /// Updates a Goal.
    UpdateGoal {
        /// The Goal.
        id: StepTarget,
        /// What to change.
        request: UpdateGoalRequest,
        /// Achieving a Goal over open work asks first unless this is set.
        #[serde(default)]
        confirmed: bool,
    },
    /// Updates a Commitment.
    UpdateCommitment {
        /// The Commitment.
        id: StepTarget,
        /// What to change.
        request: UpdateCommitmentRequest,
    },
    /// Updates a wait.
    UpdateExpectation {
        /// The wait.
        id: StepTarget,
        /// What to change.
        request: UpdateExpectationRequest,
    },
    /// Updates an Info.
    UpdateInfo {
        /// The Info.
        id: StepTarget,
        /// What to change.
        request: UpdateInfoRequest,
    },
    /// Updates a Domain, Project or Tag.
    UpdateDomain {
        /// Its row.
        id: StepTarget,
        /// What to change.
        request: UpdateDomainRequest,
    },
    /// Updates a Flow.
    UpdateFlow {
        /// The Flow.
        id: StepTarget,
        /// What to change.
        request: UpdateFlowRequest,
    },
    /// Updates a Flow item.
    UpdateFlowItem {
        /// Which kind of item.
        item_type: FlowItemType,
        /// The item.
        id: StepTarget,
        /// What to change.
        request: UpdateFlowItemRequest,
    },
    /// Updates the wait an Asynchronous Task spawns when done.
    UpdateSpawnedWait {
        /// The Task.
        task_id: StepTarget,
        /// What to change.
        request: UpdateSpawnedWaitRequest,
    },
    /// Corrects when a Task was done.
    SetTaskDoneAt {
        /// The Task.
        id: StepTarget,
        /// When it was done.
        at: NaiveDateTime,
    },
    /// Replaces a Task's or Goal's explicit block reasons.
    SetBlockReasons {
        /// `task` or `goal`.
        owner_type: String,
        /// The Task or Goal.
        id: StepTarget,
        /// The reasons, in order.
        reasons: Vec<String>,
    },
    /// Puts a Tag on a node, or takes it off.
    SetTag {
        /// `task`, `goal`, `commitment` or `expectation`.
        kind: String,
        /// The node.
        id: StepTarget,
        /// The Tag's row id.
        tag_id: i64,
        /// On, or off.
        present: bool,
    },
    /// Makes a Task depend on a Task, Goal or wait, or stops it.
    SetTaskDependency {
        /// The dependent Task.
        task_id: StepTarget,
        /// What it depends on.
        dependency: Dependency,
        /// Add, or remove.
        present: bool,
    },
    /// Makes a Flow a Habit, or changes its recurrence.
    SetFlowRecurrence {
        /// The Flow.
        flow_id: StepTarget,
        /// The recurrence.
        request: SetRecurrenceRequest,
    },
    /// Makes a Habit a plain Flow again.
    DeleteFlowRecurrence {
        /// The Flow.
        flow_id: StepTarget,
    },
    /// Drops every edit made to one of a Habit's occurrences, as the editor's *Discard* does.
    ClearHabitModifications {
        /// The Habit.
        flow_id: StepTarget,
    },
    /// Archives a Habit and forks a fresh copy of it. Answers the copy.
    ForkFlow {
        /// The Habit.
        flow_id: StepTarget,
    },
    /// Sets a Flow item's cycles. Answers the template a Habit was forked into, if it was.
    SetFlowItemCycles {
        /// The item's Flow.
        flow_id: StepTarget,
        /// Which kind of item.
        item_type: FlowItemType,
        /// The item.
        item_id: StepTarget,
        /// Its cycles.
        cycles: Vec<FlowCycleInput>,
        /// How the occurrences already edited are reconciled.
        #[serde(default)]
        reconcile: Option<Reconcile>,
    },
    /// Makes one Flow item depend on another in its Flow, or stops it.
    SetFlowDependency {
        /// The Flow.
        flow_id: StepTarget,
        /// The dependent item's kind.
        dependent_type: FlowItemType,
        /// The dependent item.
        dependent_id: StepTarget,
        /// The prerequisite's kind.
        depends_on_type: FlowItemType,
        /// The prerequisite.
        depends_on_id: StepTarget,
        /// Add, or remove.
        present: bool,
    },
}

/// One step as a gesture lists it: the write, and whether the gesture goes on without it.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct StepEntry {
    /// The write.
    #[serde(flatten)]
    pub step: GestureStep,
    /// When the write is refused, take back what it wrote and carry on, answering
    /// `{"refused": <the error>}` for it. Without it, a refusal refuses the whole gesture.
    #[serde(default)]
    pub may_be_refused: bool,
}

/// Runs `steps` in order, answering each one's result.
pub async fn run(
    db: &mut Db<Transactional>,
    steps: Vec<StepEntry>,
    now: NaiveDateTime,
) -> Result<Vec<Value>, WireError> {
    let mut answers: Vec<Value> = Vec::with_capacity(steps.len());
    for entry in steps {
        let answer = if entry.may_be_refused {
            let made = answers.clone();
            match db
                .tolerating(async |db| Box::pin(run_one(db, entry.step, &made, now)).await)
                .await
                .map_err(WireError::from_error)?
            {
                Ok(answer) => answer,
                Err(refusal) => json!({ "refused": refusal }),
            }
        } else {
            // Boxed: one step's future is as large as the largest write it can make, and held
            // inline it overflows a runtime worker's stack.
            Box::pin(run_one(db, entry.step, &answers, now)).await?
        };
        answers.push(answer);
    }
    Ok(answers)
}

async fn run_one(
    db: &mut Db<Transactional>,
    step: GestureStep,
    made: &[Value],
    now: NaiveDateTime,
) -> Result<Value, WireError> {
    let id = |target: &StepTarget| resolve(target, made);
    match step {
        GestureStep::Move {
            kind,
            id: node,
            parent_kind,
            parent,
            position,
        } => {
            let node = id(&node)?;
            let parent = id(&parent)?;
            move_node(db, &kind, &node, &parent_kind, &parent, position, now).await
        }
        GestureStep::Duplicate {
            kind,
            id: node,
            parent_kind,
            parent_id,
            position,
        } => duplicate(db, &kind, node, &parent_kind, parent_id, position).await,
        GestureStep::Delete { node } => {
            super::delete_one(db, &node, now).await?;
            Ok(Value::Null)
        }
        GestureStep::CreateTask { request } => wire(write::create_task(db, request, now).await),
        GestureStep::CreateGoal { request } => wire(write::create_goal(db, request, now).await),
        GestureStep::CreateCommitment { request } => {
            wire(write::create_commitment(db, request, now).await)
        }
        GestureStep::CreateExpectation { request } => {
            wire(write::create_expectation(db, request, now).await)
        }
        GestureStep::CreateInfo { request } => wire(write::create_info(db, request, now).await),
        GestureStep::CreateDomain { request } => wire(db.domains().create(request).await),
        GestureStep::CreateFlow { request } => wire(db.flows().create(request).await),
        GestureStep::CreateFlowItem { item_type, request } => {
            create_flow_item(db, item_type, request).await
        }
        GestureStep::UpdateTask {
            id: task,
            request,
            confirmed,
            descendant_plans,
        } => json_of(
            composite::update_task_confirmed(
                db,
                &id(&task)?,
                request,
                confirmed,
                descendant_plans,
                now,
            )
            .await?,
        ),
        GestureStep::UpdateGoal {
            id: goal,
            request,
            confirmed,
        } => json_of(
            composite::update_goal_confirmed(db, &id(&goal)?, request, confirmed, now).await?,
        ),
        GestureStep::UpdateCommitment {
            id: commitment,
            request,
        } => wire(write::update_commitment(db, &id(&commitment)?, request, now).await),
        GestureStep::UpdateExpectation { id: wait, request } => {
            wire(write::update_expectation(db, &id(&wait)?, request, now).await)
        }
        GestureStep::UpdateInfo { id: info, request } => {
            wire(write::update_info(db, stored(&id(&info)?)?, request, now).await)
        }
        GestureStep::UpdateDomain {
            id: domain,
            request,
        } => wire(
            db.domains()
                .update(DomainId(stored(&id(&domain)?)?), request)
                .await,
        ),
        GestureStep::UpdateFlow { id: flow, request } => json_of(
            composite::update_flow_checked(db, FlowId(stored(&id(&flow)?)?), request, now).await?,
        ),
        GestureStep::UpdateFlowItem {
            item_type,
            id: item,
            request,
        } => update_flow_item(db, item_type, stored(&id(&item)?)?, request).await,
        GestureStep::UpdateSpawnedWait { task_id, request } => wire(
            crate::tasks::waits::update_spawned_wait(db, TaskId(stored(&id(&task_id)?)?), request)
                .await,
        ),
        GestureStep::SetTaskDoneAt { id: task, at } => {
            wire(write::set_done_at(db, &id(&task)?, at, now).await)
        }
        GestureStep::SetBlockReasons {
            owner_type,
            id: owner,
            reasons,
        } => wire(write::set_block_reasons(db, &owner_type, &id(&owner)?, &reasons, now).await),
        GestureStep::SetTag {
            kind,
            id: node,
            tag_id,
            present,
        } => wire(write::set_tag(db, &kind, &id(&node)?, tag_id, present, now).await),
        GestureStep::SetTaskDependency {
            task_id,
            dependency,
            present,
        } => {
            let task = id(&task_id)?;
            if present {
                wire(write::add_dependency(db, &task, dependency, now).await)
            } else {
                wire(write::remove_dependency(db, &task, dependency, now).await)
            }
        }
        GestureStep::SetFlowRecurrence { flow_id, request } => json_of(
            composite::set_flow_recurrence_checked(
                db,
                FlowId(stored(&id(&flow_id)?)?),
                request,
                now,
            )
            .await?,
        ),
        GestureStep::DeleteFlowRecurrence { flow_id } => wire(
            db.flows()
                .delete_recurrence(FlowId(stored(&id(&flow_id)?)?))
                .await,
        ),
        GestureStep::ClearHabitModifications { flow_id } => wire(
            db.flows()
                .clear_habit_modifications(FlowId(stored(&id(&flow_id)?)?))
                .await,
        ),
        GestureStep::ForkFlow { flow_id } => {
            wire(flows::archive_and_fork(db, FlowId(stored(&id(&flow_id)?)?), now).await)
        }
        GestureStep::SetFlowItemCycles {
            flow_id,
            item_type,
            item_id,
            cycles,
            reconcile,
        } => json_of(
            composite::set_item_cycles_confirmed(
                db,
                FlowId(stored(&id(&flow_id)?)?),
                item_type,
                stored(&id(&item_id)?)?,
                &cycles,
                reconcile,
                None,
                now,
            )
            .await?,
        ),
        GestureStep::SetFlowDependency {
            flow_id,
            dependent_type,
            dependent_id,
            depends_on_type,
            depends_on_id,
            present,
        } => {
            let dependent = stored(&id(&dependent_id)?)?;
            let depends_on = stored(&id(&depends_on_id)?)?;
            if present {
                let flow = stored(&id(&flow_id)?)?;
                wire(
                    db.flows()
                        .add_dependency(
                            flow,
                            dependent_type,
                            dependent,
                            depends_on_type,
                            depends_on,
                        )
                        .await,
                )
            } else {
                wire(
                    db.flows()
                        .remove_dependency(dependent_type, dependent, depends_on_type, depends_on)
                        .await,
                )
            }
        }
    }
}

/// The id `target` names: its own, or the id of what an earlier step made — its `id`, or a
/// copy's `copy.id`, or a fork's `id`.
fn resolve(target: &StepTarget, made: &[Value]) -> Result<NodeId, WireError> {
    match target {
        StepTarget::Id(id) => Ok(id.clone()),
        StepTarget::Forked { step, forked, id } => {
            let answer = made.get(*step).ok_or_else(|| {
                WireError::invalid_request(format!("no earlier step {step} to name"))
            })?;
            if answer.is_null() {
                return Ok(NodeId::Stored(*id));
            }
            if forked == "flow" {
                let flow = answer
                    .get("flow_id")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| {
                        WireError::invalid_request(format!("step {step} forked no Habit"))
                    })?;
                return Ok(NodeId::Stored(flow));
            }
            let pairs = match forked.as_str() {
                "flow_goal" => "goals",
                "flow_task" => "tasks",
                "flow_commitment" => "commitments",
                "flow_expectation" => "expectations",
                other => {
                    return Err(WireError::invalid_request(format!(
                        "{other} is not a forked kind"
                    )))
                }
            };
            let renamed = answer
                .get(pairs)
                .and_then(Value::as_array)
                .and_then(|pairs| {
                    pairs.iter().find_map(|pair| {
                        (pair.get(0).and_then(Value::as_i64) == Some(*id))
                            .then(|| pair.get(1).and_then(Value::as_i64))
                            .flatten()
                    })
                })
                .unwrap_or(*id);
            Ok(NodeId::Stored(renamed))
        }
        StepTarget::Made { step } => {
            let answer = made.get(*step).ok_or_else(|| {
                WireError::invalid_request(format!("no earlier step {step} to name"))
            })?;
            let id = answer
                .get("id")
                .or_else(|| answer.get("copy").and_then(|copy| copy.get("id")))
                .cloned()
                .ok_or_else(|| {
                    WireError::invalid_request(format!("step {step} made no node to name"))
                })?;
            serde_json::from_value(id).map_err(|error| WireError::internal(error.to_string()))
        }
    }
}

fn stored(id: &NodeId) -> Result<i64, WireError> {
    id.stored()
        .ok_or_else(|| WireError::invalid_request("a derived node cannot be named here"))
}

fn json_of(value: impl Serialize) -> Result<Value, WireError> {
    serde_json::to_value(value).map_err(|error| WireError::internal(error.to_string()))
}

fn wire<T: Serialize, E: Into<crate::error::AppError>>(
    result: Result<T, E>,
) -> Result<Value, WireError> {
    json_of(result.map_err(WireError::from_error)?)
}

/// The `parent_type` a node of `kind` records for a parent of `parent_kind`, as the app's tree
/// writes it: a Task-like node names a Goal, Task or Commitment by its kind and any domains-table
/// row as `project`; an Info names any board node; a Flow hangs from an Aspect, Domain, Project
/// or Goal; a Flow item from its Flow or another item.
fn parent_type(kind: &str, parent_kind: &str) -> Result<String, WireError> {
    let refused =
        || WireError::invalid_request(format!("a {kind} cannot hang from a {parent_kind}"));
    match kind {
        "info" => match parent_kind {
            "flow" | "flow_goal" | "flow_task" | "flow_commitment" | "flow_expectation"
            | "habit_group" => Err(refused()),
            other => Ok(other.to_owned()),
        },
        "flow" => match parent_kind {
            "aspect" | "domain" | "project" | "goal" => Ok(parent_kind.to_owned()),
            _ => Err(refused()),
        },
        "flow_goal" | "flow_task" | "flow_commitment" | "flow_expectation" => match parent_kind {
            "flow" | "flow_goal" | "flow_task" | "flow_commitment" => Ok(parent_kind.to_owned()),
            _ => Err(refused()),
        },
        _ => Ok(match parent_kind {
            "goal" | "task" | "commitment" => parent_kind.to_owned(),
            _ => "project".to_owned(),
        }),
    }
}

/// An update request of type `T` that moves a node: its parent link and position, nothing else.
fn move_request<T: serde::de::DeserializeOwned>(
    parent_type: Option<&str>,
    parent: &NodeId,
    position: i64,
) -> Result<T, WireError> {
    let mut fields = json!({ "parent_id": parent, "position": position });
    if let Some(parent_type) = parent_type {
        fields["parent_type"] = json!(parent_type);
    }
    serde_json::from_value(fields).map_err(|error| WireError::internal(error.to_string()))
}

async fn move_node(
    db: &mut Db<Transactional>,
    kind: &str,
    node: &NodeId,
    parent_kind: &str,
    parent: &NodeId,
    position: i64,
    now: NaiveDateTime,
) -> Result<Value, WireError> {
    let link = parent_type(kind, parent_kind)?;
    match kind {
        "task" => json_of(
            composite::update_task_confirmed(
                db,
                node,
                move_request(Some(&link), parent, position)?,
                false,
                None,
                now,
            )
            .await?,
        ),
        "goal" => json_of(
            composite::update_goal_confirmed(
                db,
                node,
                move_request(Some(&link), parent, position)?,
                false,
                now,
            )
            .await?,
        ),
        "commitment" => wire(
            write::update_commitment(db, node, move_request(Some(&link), parent, position)?, now)
                .await,
        ),
        "expectation" => wire(
            write::update_expectation(db, node, move_request(Some(&link), parent, position)?, now)
                .await,
        ),
        "info" => wire(
            write::update_info(
                db,
                stored(node)?,
                move_request(Some(&link), parent, position)?,
                now,
            )
            .await,
        ),
        "flow" => json_of(
            composite::update_flow_checked(
                db,
                FlowId(stored(node)?),
                move_request(Some(&link), parent, position)?,
                now,
            )
            .await?,
        ),
        "flow_goal" | "flow_task" | "flow_commitment" | "flow_expectation" => {
            update_flow_item(
                db,
                flow_item_type(kind)?,
                stored(node)?,
                move_request(Some(&link), parent, position)?,
            )
            .await
        }
        "domain" | "project" | "tag" => wire(
            db.domains()
                .update(
                    DomainId(stored(node)?),
                    move_request(None, parent, position)?,
                )
                .await,
        ),
        other => Err(WireError::invalid_request(format!(
            "a {other} cannot be moved"
        ))),
    }
}

async fn duplicate(
    db: &mut Db<Transactional>,
    kind: &str,
    id: i64,
    parent_kind: &str,
    parent_id: i64,
    position: i64,
) -> Result<Value, WireError> {
    let subtree = |duplicable| (duplicable, parent_type(kind, parent_kind));
    let (duplicable, link) = match kind {
        "task" => subtree(DuplicableKind::Task),
        "goal" => subtree(DuplicableKind::Goal),
        "info" => subtree(DuplicableKind::Info),
        "domain" | "project" | "tag" => (DuplicableKind::Domain, Ok(String::new())),
        "flow" => {
            let flow = flows::duplicate_flow(
                db,
                FlowId(id),
                &parent_type(kind, parent_kind)?,
                parent_id,
                position,
            )
            .await
            .map_err(WireError::from_error)?;
            return json_of(json!({ "id": flow.id, "left_behind": [] }));
        }
        "flow_goal" | "flow_task" | "flow_commitment" | "flow_expectation" => {
            let copy = flows::duplicate_flow_item(
                db,
                flow_item_type(kind)?,
                id,
                &parent_type(kind, parent_kind)?,
                parent_id,
                position,
            )
            .await
            .map_err(WireError::from_error)?;
            return json_of(json!({ "id": copy, "left_behind": [] }));
        }
        other => {
            return Err(WireError::invalid_request(format!(
                "a {other} cannot be duplicated"
            )))
        }
    };
    let copy = duplicate_subtree(db, duplicable, id, &link?, parent_id, position)
        .await
        .map_err(WireError::from_error)?;
    json_of(json!({ "id": copy.root_id, "left_behind": copy.left_behind }))
}

async fn create_flow_item(
    db: &mut Db<Transactional>,
    item_type: FlowItemType,
    request: CreateFlowItemRequest,
) -> Result<Value, WireError> {
    let mut flows = db.flows();
    match item_type {
        FlowItemType::FlowGoal => wire(flows.create_goal(request).await),
        FlowItemType::FlowTask => wire(flows.create_task(request).await),
        FlowItemType::FlowCommitment => wire(flows.create_commitment_item(request).await),
        FlowItemType::FlowExpectation => wire(flows.create_expectation_item(request).await),
    }
}

async fn update_flow_item(
    db: &mut Db<Transactional>,
    item_type: FlowItemType,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<Value, WireError> {
    match item_type {
        FlowItemType::FlowGoal => wire(flows::update_flow_goal(db, id, request).await),
        FlowItemType::FlowTask => wire(flows::update_flow_task(db, id, request).await),
        FlowItemType::FlowCommitment => wire(flows::update_flow_commitment(db, id, request).await),
        FlowItemType::FlowExpectation => {
            wire(flows::update_flow_expectation(db, id, request).await)
        }
    }
}

fn flow_item_type(kind: &str) -> Result<FlowItemType, WireError> {
    match kind {
        "flow_goal" => Ok(FlowItemType::FlowGoal),
        "flow_task" => Ok(FlowItemType::FlowTask),
        "flow_commitment" => Ok(FlowItemType::FlowCommitment),
        "flow_expectation" => Ok(FlowItemType::FlowExpectation),
        other => Err(WireError::invalid_request(format!(
            "{other} is not a flow item kind"
        ))),
    }
}
