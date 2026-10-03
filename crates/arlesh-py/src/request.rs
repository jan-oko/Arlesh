//! The operation table: every database call Python can make, as one tagged request.
//!
//! Each arm is what the matching Tauri command does — open a session, call the domain, commit —
//! and nothing more: the compositions with a guard or several writes live in the core
//! (`nodes::composite`, `tasks::gestures`, `mindmap::board`), so both hosts run the same ones.
//!
//! Every write runs in a transaction ([`SessionFactory::begin`]), even a single statement: that is
//! where a non-desktop client stamps its name over the journal's context, and a pooled write has
//! no transaction to hide the stamp in.

use std::path::Path;
use std::sync::Arc;

use arlesh_core::{
    capacity::{AgentCapacity, CAPACITY_FILE},
    database::session::{Db, SessionFactory, Transactional},
    domains::model::{CreateDomainRequest, DomainId, DomainSubtype, UpdateDomainRequest},
    duplicate::{duplicate_subtree, DuplicableKind},
    error::{AppError, WireError, WireErrorKind},
    flows::{
        self,
        cycles::Reconcile,
        model::{
            CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowId, FlowItemType,
            SetRecurrenceRequest, StartFlowRequest, UpdateFlowItemRequest, UpdateFlowRequest,
        },
    },
    infos::model::{CreateInfoRequest, InfoId, UpdateInfoRequest},
    mindmap,
    nodes::{composite, id::NodeId, write},
    tasks::{
        self, gestures,
        model::{
            CommitmentId, CreateCommitmentRequest, CreateExpectationRequest, CreateGoalRequest,
            CreateTaskRequest, Dependency, ExpectationId, GoalId, TaskId, UpdateCommitmentRequest,
            UpdateExpectationRequest, UpdateGoalRequest, UpdateSpawnedWaitRequest,
            UpdateTaskRequest,
        },
        rules::gestures::{StatusStep, VerdictPress},
    },
};
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::{Failure, Raised};

/// One database call: a JSON object whose `op` names the operation and whose other fields are its
/// arguments.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(tag = "op", rename_all = "snake_case")]
pub(crate) enum Request {
    // ---- Reads ------------------------------------------------------------------------------
    /// The whole board, derived at `now` (default: the local wall clock), blocked by the agent
    /// capacity lock when `at_capacity` (default: whatever the lock file beside the database says).
    Board {
        /// The instant the board is derived at.
        #[serde(default)]
        now: Option<NaiveDateTime>,
        /// Whether the agents are at capacity.
        #[serde(default)]
        at_capacity: Option<bool>,
    },
    /// One stored Task, with what blocks it.
    GetTask {
        /// The Task's row id.
        id: i64,
    },
    /// One stored Goal.
    GetGoal {
        /// The Goal's row id.
        id: i64,
    },
    /// One stored Commitment.
    GetCommitment {
        /// The Commitment's row id.
        id: i64,
    },
    /// One Aspect, Domain, Project or Tag.
    GetDomain {
        /// Its row id.
        id: i64,
    },
    /// One Info.
    GetInfo {
        /// Its row id.
        id: i64,
    },
    /// One Flow or Habit template.
    GetFlow {
        /// Its row id.
        id: i64,
    },
    /// What a Task depends on.
    TaskDependencies {
        /// The Task, stored or derived.
        id: NodeId,
    },
    /// When a Task was done, if it is.
    TaskDoneAt {
        /// The Task, stored or derived.
        id: NodeId,
    },

    // ---- Tasks ------------------------------------------------------------------------------
    /// Creates a Task.
    CreateTask {
        /// What to create.
        request: CreateTaskRequest,
    },
    /// Updates a Task, stored or derived — and moves it, when the request names a parent.
    UpdateTask {
        /// The Task.
        id: NodeId,
        /// What to change.
        request: UpdateTaskRequest,
        /// Completing a Habit occurrence over unfinished children asks first unless this is set.
        #[serde(default)]
        confirmed: bool,
    },
    /// Deletes a Task and its subtree.
    DeleteTask {
        /// The Task.
        id: NodeId,
    },
    /// One step of the status cycle, or `Alt+Enter`.
    StepTaskStatus {
        /// The Task.
        id: NodeId,
        /// Which gesture.
        step: StatusStep,
        /// As for [`Request::UpdateTask`].
        #[serde(default)]
        confirmed: bool,
    },
    /// Flips a Task between Agentic and not.
    ToggleTaskAgentic {
        /// The Task.
        id: NodeId,
    },
    /// Makes a Task depend on a Task, Goal or wait.
    AddTaskDependency {
        /// The dependent Task.
        task_id: NodeId,
        /// What it comes after.
        dependency: Dependency,
    },
    /// Removes one of a Task's dependencies.
    RemoveTaskDependency {
        /// The dependent Task.
        task_id: NodeId,
        /// The dependency to remove.
        dependency: Dependency,
    },
    /// Corrects when a done Task was done.
    SetTaskDoneAt {
        /// The Task.
        id: NodeId,
        /// When it was done.
        at: NaiveDateTime,
    },
    /// Copies a Task and its subtree under a new parent.
    DuplicateTask {
        /// The Task to copy.
        id: i64,
        /// The new parent's kind.
        target_type: String,
        /// The new parent's row id.
        target_id: i64,
        /// Where among the new parent's children.
        position: i64,
    },

    // ---- Goals ------------------------------------------------------------------------------
    /// Creates a Goal.
    CreateGoal {
        /// What to create.
        request: CreateGoalRequest,
    },
    /// Updates a Goal — and moves it, when the request names a parent.
    UpdateGoal {
        /// The Goal.
        id: NodeId,
        /// What to change.
        request: UpdateGoalRequest,
        /// Achieving a Goal over unfinished children asks first unless this is set.
        #[serde(default)]
        confirmed: bool,
    },
    /// Deletes a Goal and its subtree.
    DeleteGoal {
        /// The Goal.
        id: NodeId,
    },
    /// Copies a Goal and its subtree under a new parent.
    DuplicateGoal {
        /// The Goal to copy.
        id: i64,
        /// The new parent's kind.
        target_type: String,
        /// The new parent's row id.
        target_id: i64,
        /// Where among the new parent's children.
        position: i64,
    },

    // ---- Commitments ------------------------------------------------------------------------
    /// Creates a Commitment.
    CreateCommitment {
        /// What to create.
        request: CreateCommitmentRequest,
    },
    /// Updates a Commitment — and moves it, when the request names a parent.
    UpdateCommitment {
        /// The Commitment.
        id: NodeId,
        /// What to change.
        request: UpdateCommitmentRequest,
    },
    /// Deletes a Commitment.
    DeleteCommitment {
        /// The Commitment.
        id: NodeId,
    },
    /// A press of a verdict control.
    PressCommitmentVerdict {
        /// The Commitment.
        id: NodeId,
        /// Which control.
        press: VerdictPress,
    },

    // ---- Waits ------------------------------------------------------------------------------
    /// Creates a wait.
    CreateWait {
        /// What to create.
        request: CreateExpectationRequest,
    },
    /// Updates a wait — and moves it, when the request names a parent.
    UpdateWait {
        /// The wait, stored or derived.
        id: NodeId,
        /// What to change.
        request: UpdateExpectationRequest,
    },
    /// Deletes a stored wait. A derived one goes with its Task.
    DeleteWait {
        /// The wait.
        id: NodeId,
    },
    /// Marks a stored wait's check done.
    CompleteWaitCheck {
        /// The wait's row id.
        id: i64,
    },
    /// Reopens a stored wait's check, due again at `due_at`.
    ReopenWaitCheck {
        /// The wait's row id.
        id: i64,
        /// When the check is due again.
        due_at: NaiveDateTime,
    },
    /// Updates the wait an Asynchronous Task spawned.
    UpdateSpawnedWait {
        /// The Task that spawned it.
        task_id: i64,
        /// What to change.
        request: UpdateSpawnedWaitRequest,
    },
    /// Marks a spawned wait's check done.
    CompleteSpawnedWaitCheck {
        /// The Task that spawned it.
        task_id: i64,
    },
    /// Reopens a spawned wait's check, due again at `due_at`.
    ReopenSpawnedWaitCheck {
        /// The Task that spawned it.
        task_id: i64,
        /// When the check is due again.
        due_at: NaiveDateTime,
    },

    // ---- Tags and block reasons -------------------------------------------------------------
    /// Puts a Tag on a node, or takes it off.
    SetTag {
        /// The node's kind: `task`, `goal`, `commitment` or `expectation`.
        kind: String,
        /// The node.
        id: NodeId,
        /// The Tag's row id.
        tag_id: i64,
        /// On (`true`) or off.
        present: bool,
    },
    /// Replaces a Task's or Goal's explicit block reasons.
    SetBlockReasons {
        /// The owner's kind: `task` or `goal`.
        owner_type: String,
        /// The owner.
        owner_id: NodeId,
        /// The reasons, in order.
        reasons: Vec<String>,
    },

    // ---- Infos ------------------------------------------------------------------------------
    /// Creates an Info.
    CreateInfo {
        /// What to create.
        request: CreateInfoRequest,
    },
    /// Updates an Info — and moves it, when the request names a parent.
    UpdateInfo {
        /// The Info's row id.
        id: i64,
        /// What to change.
        request: UpdateInfoRequest,
    },
    /// Deletes an Info.
    DeleteInfo {
        /// The Info's row id.
        id: i64,
    },
    /// Copies an Info and its subtree under a new parent.
    DuplicateInfo {
        /// The Info to copy.
        id: i64,
        /// The new parent's kind.
        target_type: String,
        /// The new parent's row id.
        target_id: i64,
        /// Where among the new parent's children.
        position: i64,
    },

    // ---- Domains and Projects ---------------------------------------------------------------
    /// Lists Aspects, Domains, Projects and Tags, or one subtype of them.
    ListDomains {
        /// Only this subtype.
        #[serde(default)]
        subtype: Option<DomainSubtype>,
    },
    /// Creates a Domain, Project or Tag.
    CreateDomain {
        /// What to create.
        request: CreateDomainRequest,
    },
    /// Updates a Domain, Project or Tag — and moves it, when the request names a parent.
    UpdateDomain {
        /// Its row id.
        id: i64,
        /// What to change.
        request: UpdateDomainRequest,
    },
    /// Deletes a Domain, Project or Tag.
    DeleteDomain {
        /// Its row id.
        id: i64,
    },
    /// Copies a Domain or Project and its subtree under a new parent.
    DuplicateDomain {
        /// The one to copy.
        id: i64,
        /// The new parent's row id.
        target_id: i64,
        /// Where among the new parent's children.
        position: i64,
    },

    // ---- Flows and Habits -------------------------------------------------------------------
    /// Creates a Flow.
    CreateFlow {
        /// What to create.
        request: CreateFlowRequest,
    },
    /// Updates a Flow — and moves it, when the request names a parent.
    UpdateFlow {
        /// The Flow's row id.
        id: i64,
        /// What to change.
        request: UpdateFlowRequest,
    },
    /// Deletes a Flow and its items.
    DeleteFlow {
        /// The Flow's row id.
        id: i64,
    },
    /// Creates a Goal item in a Flow.
    CreateFlowGoal {
        /// What to create.
        request: CreateFlowItemRequest,
    },
    /// Creates a Task item in a Flow.
    CreateFlowTask {
        /// What to create.
        request: CreateFlowItemRequest,
    },
    /// Updates a Flow's Goal item.
    UpdateFlowGoal {
        /// The item's row id.
        id: i64,
        /// What to change.
        request: UpdateFlowItemRequest,
    },
    /// Updates a Flow's Task item.
    UpdateFlowTask {
        /// The item's row id.
        id: i64,
        /// What to change.
        request: UpdateFlowItemRequest,
    },
    /// Deletes a Flow item.
    DeleteFlowItem {
        /// Goal or Task item.
        item_type: FlowItemType,
        /// The item's row id.
        id: i64,
    },
    /// Sets a Flow item's cycles. Orphaning what Habit iterations recorded asks first, unless
    /// `reconcile` says how.
    SetFlowItemCycles {
        /// The Flow.
        flow_id: i64,
        /// Goal or Task item.
        item_type: FlowItemType,
        /// The item's row id.
        item_id: i64,
        /// The cycles.
        cycles: Vec<FlowCycleInput>,
        /// How to reconcile iterations the change would orphan.
        #[serde(default)]
        reconcile: Option<Reconcile>,
        /// The instant a fork is taken at.
        #[serde(default)]
        now: Option<NaiveDateTime>,
    },
    /// Makes one Flow item depend on another.
    AddFlowDependency {
        /// The Flow.
        flow_id: i64,
        /// The dependent item's kind.
        dependent_type: FlowItemType,
        /// The dependent item's row id.
        dependent_id: i64,
        /// The prerequisite's kind.
        depends_on_type: FlowItemType,
        /// The prerequisite's row id.
        depends_on_id: i64,
    },
    /// Removes a dependency between Flow items.
    RemoveFlowDependency {
        /// The dependent item's kind.
        dependent_type: FlowItemType,
        /// The dependent item's row id.
        dependent_id: i64,
        /// The prerequisite's kind.
        depends_on_type: FlowItemType,
        /// The prerequisite's row id.
        depends_on_id: i64,
    },
    /// Starts a Flow: copies it into a real subtree under a target.
    StartFlow {
        /// The Flow's row id.
        flow_id: i64,
        /// Where, and when.
        request: StartFlowRequest,
    },
    /// Makes a Flow a Habit, or changes its Recurrence.
    SetFlowRecurrence {
        /// The Flow's row id.
        flow_id: i64,
        /// The Recurrence.
        request: SetRecurrenceRequest,
    },
    /// Takes a Habit's Recurrence away, making it a plain Flow.
    DeleteFlowRecurrence {
        /// The Flow's row id.
        flow_id: i64,
    },
    /// Drops every edit made to a Habit's occurrences (its overlays).
    ClearHabitModifications {
        /// The Habit's row id.
        flow_id: i64,
    },
    /// Archives a Habit and forks a fresh copy of it, as editing its template from now on does.
    ForkFlow {
        /// The Habit's row id.
        flow_id: i64,
        /// The instant the fork is taken at (default: the local wall clock).
        #[serde(default)]
        now: Option<NaiveDateTime>,
    },
    /// Copies a Flow under a new parent.
    DuplicateFlow {
        /// The Flow's row id.
        flow_id: i64,
        /// The new parent's kind.
        parent_type: String,
        /// The new parent's row id.
        parent_id: i64,
        /// Where among the new parent's children.
        position: i64,
    },
    /// Copies a Flow item under a new parent in its Flow.
    DuplicateFlowItem {
        /// Goal or Task item.
        item_type: FlowItemType,
        /// The item's row id.
        item_id: i64,
        /// The new parent's kind.
        parent_type: String,
        /// The new parent's row id.
        parent_id: i64,
        /// Where among the new parent's children.
        position: i64,
    },
    /// Turns a Task or Goal subtree into a Flow.
    ConvertToFlow {
        /// The root's kind.
        node_type: String,
        /// The root's row id.
        node_id: i64,
        /// Keep the subtree's dependencies as the Flow's.
        keep_dependencies: bool,
        /// Keep its Time Scopes, relative to the root's.
        map_scopes: bool,
    },
}

impl Request {
    /// Whether the request writes. A read-only database refuses these before opening a session.
    fn writes(&self) -> bool {
        !matches!(
            self,
            Self::Board { .. }
                | Self::GetTask { .. }
                | Self::GetGoal { .. }
                | Self::GetCommitment { .. }
                | Self::GetDomain { .. }
                | Self::GetInfo { .. }
                | Self::GetFlow { .. }
                | Self::TaskDependencies { .. }
                | Self::TaskDoneAt { .. }
                | Self::ListDomains { .. }
        )
    }
}

/// Reads `request` as a [`Request`], runs it, and answers its result as JSON.
pub(crate) async fn run(
    factory: &SessionFactory,
    path: &Path,
    request: &str,
) -> Result<String, Raised> {
    let request: Request = serde_json::from_str(request).map_err(|error| {
        Failure::new(WireErrorKind::InvalidRequest, format!("unreadable request: {error}"))
    })?;
    if request.writes() && factory.is_read_only() {
        return Err(Failure::new(
            WireErrorKind::InvalidRequest,
            "this database was opened read-only",
        )
        .with_details(serde_json::json!({ "reason": "read_only" }))
        .into());
    }
    let answer = dispatch(factory, path, request).await?;
    Ok(answer.to_string())
}

/// Converts a domain result's error to its wire form.
trait Wired<T> {
    /// The result, its error in wire form.
    fn wired(self) -> Result<T, WireError>;
}

impl<T, E: Into<AppError>> Wired<T> for Result<T, E> {
    fn wired(self) -> Result<T, WireError> {
        self.map_err(WireError::from_error)
    }
}

/// `value` as JSON.
fn json(value: impl Serialize) -> Result<Value, WireError> {
    serde_json::to_value(value).map_err(|error| WireError::internal(error.to_string()))
}

/// Runs `operation` in one transaction, committing it when it succeeds, and answers its result.
async fn transaction<T: Serialize>(
    factory: &SessionFactory,
    operation: impl AsyncFnOnce(&mut Db<Transactional>) -> Result<T, WireError>,
) -> Result<Value, WireError> {
    let mut db = factory.begin().await.wired()?;
    let result = operation(&mut db).await?;
    db.commit().await.wired()?;
    json(result)
}

/// The local wall clock, as every write the app makes reads it.
fn now() -> NaiveDateTime {
    chrono::Local::now().naive_local()
}

/// Whether the agent capacity lock beside the database at `path` is on.
async fn at_capacity(path: &Path) -> bool {
    let Some(directory) = path.parent() else {
        return false;
    };
    AgentCapacity::open(directory.join(CAPACITY_FILE), Arc::new(|_| {}))
        .get()
        .await
        .at_capacity
}

/// Runs one request.
async fn dispatch(
    factory: &SessionFactory,
    path: &Path,
    request: Request,
) -> Result<Value, WireError> {
    match request {
        Request::Board { now: at, at_capacity: capacity } => {
            let capacity = match capacity {
                Some(capacity) => capacity,
                None => at_capacity(path).await,
            };
            let at = at.unwrap_or_else(now);
            transaction(factory, async |db| {
                mindmap::board(db, at, capacity).await.wired()
            })
            .await
        }
        Request::GetTask { id } => transaction(factory, async |db| {
            tasks::get_task_with_blockers(db, TaskId(id)).await.wired()
        })
        .await,
        Request::GetGoal { id } => {
            transaction(factory, async |db| db.goals().get(GoalId(id)).await.wired()).await
        }
        Request::GetCommitment { id } => transaction(factory, async |db| {
            db.commitments().get(CommitmentId(id)).await.wired()
        })
        .await,
        Request::GetDomain { id } => {
            transaction(factory, async |db| db.domains().get(DomainId(id)).await.wired()).await
        }
        Request::GetInfo { id } => {
            transaction(factory, async |db| db.infos().get(InfoId(id)).await.wired()).await
        }
        Request::GetFlow { id } => {
            transaction(factory, async |db| db.flows().get(FlowId(id)).await.wired()).await
        }
        Request::TaskDependencies { id } => transaction(factory, async |db| {
            write::dependencies_of(db, &id, now()).await.wired()
        })
        .await,
        Request::TaskDoneAt { id } => {
            transaction(factory, async |db| write::done_at(db, &id, now()).await.wired()).await
        }
        Request::ListDomains { subtype } => {
            transaction(factory, async |db| db.domains().list(subtype).await.wired()).await
        }

        Request::CreateTask { request } => transaction(factory, async |db| {
            write::create_task(db, request, now()).await.wired()
        })
        .await,
        Request::UpdateTask {
            id,
            request,
            confirmed,
        } => transaction(factory, async |db| {
            composite::update_task_confirmed(db, &id, request, confirmed, now()).await
        })
        .await,
        Request::DeleteTask { id } => {
            transaction(factory, async |db| write::delete(db, "task", &id, now()).await.wired())
                .await
        }
        Request::StepTaskStatus {
            id,
            step,
            confirmed,
        } => transaction(factory, async |db| {
            gestures::step_status(db, &id, step, confirmed, now()).await
        })
        .await,
        Request::ToggleTaskAgentic { id } => {
            transaction(factory, async |db| gestures::toggle_agentic(db, &id, now()).await).await
        }
        Request::AddTaskDependency {
            task_id,
            dependency,
        } => transaction(factory, async |db| {
            write::add_dependency(db, &task_id, dependency, now()).await.wired()
        })
        .await,
        Request::RemoveTaskDependency {
            task_id,
            dependency,
        } => transaction(factory, async |db| {
            write::remove_dependency(db, &task_id, dependency, now()).await.wired()
        })
        .await,
        Request::SetTaskDoneAt { id, at } => transaction(factory, async |db| {
            write::set_done_at(db, &id, at, now()).await.wired()
        })
        .await,
        Request::DuplicateTask {
            id,
            target_type,
            target_id,
            position,
        } => transaction(factory, async |db| {
            let copy = duplicate_subtree(
                db,
                DuplicableKind::Task,
                id,
                &target_type,
                target_id,
                position,
            )
            .await
            .wired()?;
            db.tasks().get(TaskId(copy)).await.wired()
        })
        .await,

        Request::CreateGoal { request } => transaction(factory, async |db| {
            write::create_goal(db, request, now()).await.wired()
        })
        .await,
        Request::UpdateGoal {
            id,
            request,
            confirmed,
        } => transaction(factory, async |db| {
            composite::update_goal_confirmed(db, &id, request, confirmed, now()).await
        })
        .await,
        Request::DeleteGoal { id } => {
            transaction(factory, async |db| write::delete(db, "goal", &id, now()).await.wired())
                .await
        }
        Request::DuplicateGoal {
            id,
            target_type,
            target_id,
            position,
        } => transaction(factory, async |db| {
            let copy = duplicate_subtree(
                db,
                DuplicableKind::Goal,
                id,
                &target_type,
                target_id,
                position,
            )
            .await
            .wired()?;
            db.goals().get(GoalId(copy)).await.wired()
        })
        .await,

        Request::CreateCommitment { request } => transaction(factory, async |db| {
            write::create_commitment(db, request, now()).await.wired()
        })
        .await,
        Request::UpdateCommitment { id, request } => transaction(factory, async |db| {
            write::update_commitment(db, &id, request, now()).await.wired()
        })
        .await,
        Request::DeleteCommitment { id } => transaction(factory, async |db| {
            write::delete(db, "commitment", &id, now()).await.wired()
        })
        .await,
        Request::PressCommitmentVerdict { id, press } => transaction(factory, async |db| {
            gestures::press_verdict(db, &id, press, now()).await
        })
        .await,

        Request::CreateWait { request } => transaction(factory, async |db| {
            write::create_expectation(db, request, now()).await.wired()
        })
        .await,
        Request::UpdateWait { id, request } => transaction(factory, async |db| {
            write::update_expectation(db, &id, request, now()).await.wired()
        })
        .await,
        Request::DeleteWait { id } => {
            transaction(factory, async |db| composite::delete_wait(db, &id).await).await
        }
        Request::CompleteWaitCheck { id } => transaction(factory, async |db| {
            tasks::complete_expectation_check(db, ExpectationId(id), tasks::expectations::now())
                .await
                .wired()
        })
        .await,
        Request::ReopenWaitCheck { id, due_at } => transaction(factory, async |db| {
            tasks::reopen_expectation_check(db, ExpectationId(id), due_at)
                .await
                .wired()
        })
        .await,
        Request::UpdateSpawnedWait { task_id, request } => transaction(factory, async |db| {
            tasks::waits::update_spawned_wait(db, TaskId(task_id), request)
                .await
                .wired()
        })
        .await,
        Request::CompleteSpawnedWaitCheck { task_id } => transaction(factory, async |db| {
            tasks::waits::complete_spawned_check(db, TaskId(task_id), tasks::expectations::now())
                .await
                .wired()
        })
        .await,
        Request::ReopenSpawnedWaitCheck { task_id, due_at } => {
            transaction(factory, async |db| {
                tasks::waits::reopen_spawned_check(db, TaskId(task_id), due_at)
                    .await
                    .wired()
            })
            .await
        }

        Request::SetTag {
            kind,
            id,
            tag_id,
            present,
        } => transaction(factory, async |db| {
            write::set_tag(db, &kind, &id, tag_id, present, now()).await.wired()
        })
        .await,
        Request::SetBlockReasons {
            owner_type,
            owner_id,
            reasons,
        } => transaction(factory, async |db| {
            write::set_block_reasons(db, &owner_type, &owner_id, &reasons, now())
                .await
                .wired()
        })
        .await,

        Request::CreateInfo { request } => transaction(factory, async |db| {
            write::create_info(db, request, now()).await.wired()
        })
        .await,
        Request::UpdateInfo { id, request } => transaction(factory, async |db| {
            write::update_info(db, id, request, now()).await.wired()
        })
        .await,
        Request::DeleteInfo { id } => {
            transaction(factory, async |db| composite::delete_info(db, id).await).await
        }
        Request::DuplicateInfo {
            id,
            target_type,
            target_id,
            position,
        } => transaction(factory, async |db| {
            let copy = duplicate_subtree(
                db,
                DuplicableKind::Info,
                id,
                &target_type,
                target_id,
                position,
            )
            .await
            .wired()?;
            db.infos().get(InfoId(copy)).await.wired()
        })
        .await,

        Request::CreateDomain { request } => {
            transaction(factory, async |db| db.domains().create(request).await.wired()).await
        }
        Request::UpdateDomain { id, request } => transaction(factory, async |db| {
            db.domains().update(DomainId(id), request).await.wired()
        })
        .await,
        Request::DeleteDomain { id } => {
            transaction(factory, async |db| db.domains().delete(DomainId(id)).await.wired()).await
        }
        Request::DuplicateDomain {
            id,
            target_id,
            position,
        } => transaction(factory, async |db| {
            let copy =
                duplicate_subtree(db, DuplicableKind::Domain, id, "", target_id, position)
                    .await
                    .wired()?;
            db.domains().get(DomainId(copy)).await.wired()
        })
        .await,

        Request::CreateFlow { request } => {
            transaction(factory, async |db| db.flows().create(request).await.wired()).await
        }
        Request::UpdateFlow { id, request } => transaction(factory, async |db| {
            flows::update_flow(db, FlowId(id), request).await.wired()
        })
        .await,
        Request::DeleteFlow { id } => {
            transaction(factory, async |db| flows::delete_flow(db, FlowId(id)).await.wired()).await
        }
        Request::CreateFlowGoal { request } => {
            transaction(factory, async |db| db.flows().create_goal(request).await.wired()).await
        }
        Request::CreateFlowTask { request } => {
            transaction(factory, async |db| db.flows().create_task(request).await.wired()).await
        }
        Request::UpdateFlowGoal { id, request } => transaction(factory, async |db| {
            flows::update_flow_goal(db, id, request).await.wired()
        })
        .await,
        Request::UpdateFlowTask { id, request } => transaction(factory, async |db| {
            flows::update_flow_task(db, id, request).await.wired()
        })
        .await,
        Request::DeleteFlowItem { item_type, id } => transaction(factory, async |db| {
            db.flows().delete_item(item_type, id).await.wired()
        })
        .await,
        Request::SetFlowItemCycles {
            flow_id,
            item_type,
            item_id,
            cycles,
            reconcile,
            now: at,
        } => transaction(factory, async |db| {
            composite::set_item_cycles_confirmed(
                db,
                FlowId(flow_id),
                item_type,
                item_id,
                &cycles,
                reconcile,
                at,
            )
            .await
        })
        .await,
        Request::AddFlowDependency {
            flow_id,
            dependent_type,
            dependent_id,
            depends_on_type,
            depends_on_id,
        } => transaction(factory, async |db| {
            db.flows()
                .add_dependency(
                    flow_id,
                    dependent_type,
                    dependent_id,
                    depends_on_type,
                    depends_on_id,
                )
                .await
                .wired()
        })
        .await,
        Request::RemoveFlowDependency {
            dependent_type,
            dependent_id,
            depends_on_type,
            depends_on_id,
        } => transaction(factory, async |db| {
            db.flows()
                .remove_dependency(dependent_type, dependent_id, depends_on_type, depends_on_id)
                .await
                .wired()
        })
        .await,
        Request::StartFlow { flow_id, request } => transaction(factory, async |db| {
            flows::start(db, FlowId(flow_id), request).await.wired()
        })
        .await,
        Request::SetFlowRecurrence { flow_id, request } => transaction(factory, async |db| {
            flows::set_flow_recurrence(db, FlowId(flow_id), request)
                .await
                .wired()
        })
        .await,
        Request::DeleteFlowRecurrence { flow_id } => transaction(factory, async |db| {
            db.flows().delete_recurrence(FlowId(flow_id)).await.wired()
        })
        .await,
        Request::ClearHabitModifications { flow_id } => transaction(factory, async |db| {
            db.flows()
                .clear_habit_modifications(FlowId(flow_id))
                .await
                .wired()
        })
        .await,
        Request::ForkFlow { flow_id, now: at } => {
            let at = at.unwrap_or_else(now);
            transaction(factory, async |db| {
                flows::archive_and_fork(db, FlowId(flow_id), at).await.wired()
            })
            .await
        }
        Request::DuplicateFlow {
            flow_id,
            parent_type,
            parent_id,
            position,
        } => transaction(factory, async |db| {
            flows::duplicate_flow(db, FlowId(flow_id), &parent_type, parent_id, position)
                .await
                .wired()
        })
        .await,
        Request::DuplicateFlowItem {
            item_type,
            item_id,
            parent_type,
            parent_id,
            position,
        } => transaction(factory, async |db| {
            flows::duplicate_flow_item(db, item_type, item_id, &parent_type, parent_id, position)
                .await
                .wired()
        })
        .await,
        Request::ConvertToFlow {
            node_type,
            node_id,
            keep_dependencies,
            map_scopes,
        } => transaction(factory, async |db| {
            flows::convert_to_flow(db, &node_type, node_id, keep_dependencies, map_scopes)
                .await
                .wired()
        })
        .await,
    }
}
