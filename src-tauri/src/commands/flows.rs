//! Tauri commands for flow operations.
//!
//! Read-only work and single writes open a pooled session with `factory.connect()`. Everything
//! that writes more than once, or writes something it read first, opens `factory.begin()` and
//! commits — and each of those has a command-level test in `tests/flows_commands.rs`, because a
//! deleted `commit()` still compiles and rolls back silently. See ADR-0004.

use tauri::State;

use crate::backend::AppBackend;
use crate::{
    error::WireError,
    flows::{
        self,
        model::{
            CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCommitment, FlowCycleInput,
            FlowDependency, FlowExpectation, FlowGoal, FlowItemCycle, FlowItemType, FlowOrigin,
            FlowRecurrence, FlowTask, MaterializedFlow, SetRecurrenceRequest, StartFlowRequest,
            TargetRef, UpdateFlowItemRequest, UpdateFlowRequest,
        },
    },
};

/// Creates a new flow.
#[tauri::command]
pub async fn create_flow(
    backend: State<'_, AppBackend>,
    request: CreateFlowRequest,
) -> Result<Flow, WireError> {
    backend.create_flow(request).await
}

/// Fetches a flow by id.
#[tauri::command]
pub async fn get_flow(backend: State<'_, AppBackend>, id: i64) -> Result<Flow, WireError> {
    backend.get_flow(id).await
}

/// Lists all flows.
#[tauri::command]
pub async fn list_flows(backend: State<'_, AppBackend>) -> Result<Vec<Flow>, WireError> {
    backend.list_flows().await
}

/// Updates a flow.
#[tauri::command]
pub async fn update_flow(
    backend: State<'_, AppBackend>,
    id: i64,
    request: UpdateFlowRequest,
) -> Result<Flow, WireError> {
    backend.update_flow(id, request).await
}

/// Deletes a flow (and its items).
#[tauri::command]
pub async fn delete_flow(backend: State<'_, AppBackend>, id: i64) -> Result<(), WireError> {
    backend.delete_flow(id).await
}

/// Creates a flow-goal item.
#[tauri::command]
pub async fn create_flow_goal(
    backend: State<'_, AppBackend>,
    request: CreateFlowItemRequest,
) -> Result<FlowGoal, WireError> {
    backend.create_flow_goal(request).await
}

/// Creates a flow-task item.
#[tauri::command]
pub async fn create_flow_task(
    backend: State<'_, AppBackend>,
    request: CreateFlowItemRequest,
) -> Result<FlowTask, WireError> {
    backend.create_flow_task(request).await
}

/// Creates a flow **Commitment** item.
#[tauri::command]
pub async fn create_flow_commitment(
    backend: State<'_, AppBackend>,
    request: CreateFlowItemRequest,
) -> Result<FlowCommitment, WireError> {
    backend.create_flow_commitment(request).await
}

/// Creates a flow **wait** item.
#[tauri::command]
pub async fn create_flow_expectation(
    backend: State<'_, AppBackend>,
    request: CreateFlowItemRequest,
) -> Result<FlowExpectation, WireError> {
    backend.create_flow_expectation(request).await
}

/// Updates a flow **Commitment** item.
#[tauri::command]
pub async fn update_flow_commitment(
    backend: State<'_, AppBackend>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowCommitment, WireError> {
    backend.update_flow_commitment(id, request).await
}

/// Updates a flow **wait** item.
#[tauri::command]
pub async fn update_flow_expectation(
    backend: State<'_, AppBackend>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowExpectation, WireError> {
    backend.update_flow_expectation(id, request).await
}

/// Lists a flow's goal items.
#[tauri::command]
pub async fn list_flow_goals(
    backend: State<'_, AppBackend>,
    flow_id: i64,
) -> Result<Vec<FlowGoal>, WireError> {
    backend.list_flow_goals(flow_id).await
}

/// Lists a flow's task items.
#[tauri::command]
pub async fn list_flow_tasks(
    backend: State<'_, AppBackend>,
    flow_id: i64,
) -> Result<Vec<FlowTask>, WireError> {
    backend.list_flow_tasks(flow_id).await
}

/// Lists every flow's goal items.
#[tauri::command]
pub async fn list_all_flow_goals(
    backend: State<'_, AppBackend>,
) -> Result<Vec<FlowGoal>, WireError> {
    backend.list_all_flow_goals().await
}

/// Lists every flow's task items.
#[tauri::command]
pub async fn list_all_flow_tasks(
    backend: State<'_, AppBackend>,
) -> Result<Vec<FlowTask>, WireError> {
    backend.list_all_flow_tasks().await
}

/// Updates a flow-goal item.
#[tauri::command]
pub async fn update_flow_goal(
    backend: State<'_, AppBackend>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowGoal, WireError> {
    backend.update_flow_goal(id, request).await
}

/// Updates a flow-task item.
#[tauri::command]
pub async fn update_flow_task(
    backend: State<'_, AppBackend>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowTask, WireError> {
    backend.update_flow_task(id, request).await
}

/// Starts a flow, materialising it into a real subtree under the target.
#[tauri::command]
pub async fn start_flow(
    backend: State<'_, AppBackend>,
    flow_id: i64,
    request: StartFlowRequest,
) -> Result<MaterializedFlow, WireError> {
    backend.start_flow(flow_id, request).await
}

/// Returns the subset of `candidates` a flow of the given duration may validly target. With a
/// concrete `anchor_date`, containment is exact; without one it is the coarse template-time check.
/// A `null` duration (Unscoped flow) accepts every candidate.
#[tauri::command]
pub async fn scope_valid_flow_targets(
    backend: State<'_, AppBackend>,
    duration_n: Option<i64>,
    duration_kind: Option<String>,
    anchor_date: Option<chrono::NaiveDate>,
    candidates: Vec<TargetRef>,
) -> Result<Vec<TargetRef>, WireError> {
    backend
        .scope_valid_flow_targets(duration_n, duration_kind, anchor_date, candidates)
        .await
}

/// Sets (creates or replaces) a flow's Recurrence, making it a Habit.
#[tauri::command]
pub async fn set_flow_recurrence(
    backend: State<'_, AppBackend>,
    flow_id: i64,
    request: SetRecurrenceRequest,
) -> Result<FlowRecurrence, WireError> {
    backend.set_flow_recurrence(flow_id, request).await
}

/// Fetches a flow's Recurrence, or `null` if it is a plain (non-habit) flow.
#[tauri::command]
pub async fn get_flow_recurrence(
    backend: State<'_, AppBackend>,
    flow_id: i64,
) -> Result<Option<FlowRecurrence>, WireError> {
    backend.get_flow_recurrence(flow_id).await
}

/// Deletes a flow's Recurrence, demoting the Habit back to a plain flow.
#[tauri::command]
pub async fn delete_flow_recurrence(
    backend: State<'_, AppBackend>,
    flow_id: i64,
) -> Result<(), WireError> {
    backend.delete_flow_recurrence(flow_id).await
}

/// For each of `nodes` that was materialised from a flow, returns its originating flow title.
#[tauri::command]
pub async fn flow_origins(
    backend: State<'_, AppBackend>,
    nodes: Vec<TargetRef>,
) -> Result<Vec<FlowOrigin>, WireError> {
    backend.flow_origins(nodes).await
}

/// Every real node materialised by a started flow, for the mindmap's flow-instance badge.
#[tauri::command]
pub async fn list_flow_instance_nodes(
    backend: State<'_, AppBackend>,
) -> Result<Vec<TargetRef>, WireError> {
    backend.list_flow_instance_nodes().await
}

/// Deletes a flow item (goal or task) and its cycles and dependency links.
#[tauri::command]
pub async fn delete_flow_item(
    backend: State<'_, AppBackend>,
    item_type: FlowItemType,
    id: i64,
) -> Result<(), WireError> {
    backend.delete_flow_item(item_type, id).await
}

/// Saves a flow item's cycle pairs, keeping every pair that survives. A change that would orphan
/// what an occurrence recorded is refused with
/// [`NeedsConfirmation`](crate::error::WireErrorKind::NeedsConfirmation) until `reconcile`
/// answers it — Archive & new (with `now`) or Discard & regenerate.
///
/// The pairs are diffed, not replaced: see [`flows::cycles`].
#[tauri::command]
pub async fn set_flow_item_cycles(
    backend: State<'_, AppBackend>,
    flow_id: i64,
    item_type: FlowItemType,
    item_id: i64,
    cycles: Vec<FlowCycleInput>,
    reconcile: Option<flows::cycles::Reconcile>,
    now: Option<chrono::NaiveDateTime>,
) -> Result<Option<flows::cycles::ForkedTemplate>, WireError> {
    backend
        .set_flow_item_cycles(flow_id, item_type, item_id, cycles, reconcile, now)
        .await
}

/// Lists every flow's cycle pairs.
#[tauri::command]
pub async fn list_all_flow_cycles(
    backend: State<'_, AppBackend>,
) -> Result<Vec<FlowItemCycle>, WireError> {
    backend.list_all_flow_cycles().await
}

/// Adds an intra-flow dependency (`dependent` waits on `depends_on`).
#[tauri::command]
pub async fn add_flow_dependency(
    backend: State<'_, AppBackend>,
    flow_id: i64,
    dependent_type: FlowItemType,
    dependent_id: i64,
    depends_on_type: FlowItemType,
    depends_on_id: i64,
) -> Result<(), WireError> {
    backend
        .add_flow_dependency(
            flow_id,
            dependent_type,
            dependent_id,
            depends_on_type,
            depends_on_id,
        )
        .await
}

/// Removes an intra-flow dependency.
#[tauri::command]
pub async fn remove_flow_dependency(
    backend: State<'_, AppBackend>,
    dependent_type: FlowItemType,
    dependent_id: i64,
    depends_on_type: FlowItemType,
    depends_on_id: i64,
) -> Result<(), WireError> {
    backend
        .remove_flow_dependency(dependent_type, dependent_id, depends_on_type, depends_on_id)
        .await
}

/// Lists every flow's dependencies.
#[tauri::command]
pub async fn list_all_flow_dependencies(
    backend: State<'_, AppBackend>,
) -> Result<Vec<FlowDependency>, WireError> {
    backend.list_all_flow_dependencies().await
}

/// Number of distinct completed iterations of a Habit (divergence detection for reconciliation).
#[tauri::command]
pub async fn habit_completion_count(
    backend: State<'_, AppBackend>,
    flow_id: i64,
) -> Result<i64, WireError> {
    backend.habit_completion_count(flow_id).await
}

/// Clears every Habit Modification for a flow (delete-and-regenerate reconciliation).
#[tauri::command]
pub async fn clear_habit_modifications(
    backend: State<'_, AppBackend>,
    flow_id: i64,
) -> Result<(), WireError> {
    backend.clear_habit_modifications(flow_id).await
}

/// The archive-and-new reconciliation arm: deep-clones a flow's template into a new flow and
/// archives the original Habit — it stops recurring after the Day holding `now` — in one
/// transaction. See [`flows::archive_and_fork`].
#[tauri::command]
pub async fn fork_flow(
    backend: State<'_, AppBackend>,
    flow_id: i64,
    now: chrono::NaiveDateTime,
) -> Result<Flow, WireError> {
    backend.fork_flow(flow_id, now).await
}

/// Copies a Flow — template, Recurrence and all — under a new parent (the Mindmap's Copy+Paste).
///
/// Transactional and committed here: a copy is dozens of inserts whose parent, cycle and
/// dependency remaps only make sense together.
#[tauri::command]
pub async fn duplicate_flow(
    backend: State<'_, AppBackend>,
    flow_id: i64,
    parent_type: String,
    parent_id: i64,
    position: i64,
) -> Result<Flow, WireError> {
    backend
        .duplicate_flow(flow_id, parent_type, parent_id, position)
        .await
}

/// Copies a flow item (and its nested items) within its own template. Returns the new item's id.
///
/// Transactional and committed here: the copy is one insert per nested item plus its cycle pairs
/// and dependency edges, and the remap names ids written earlier in the same run.
#[tauri::command]
pub async fn duplicate_flow_item(
    backend: State<'_, AppBackend>,
    item_type: FlowItemType,
    item_id: i64,
    parent_type: String,
    parent_id: i64,
    position: i64,
) -> Result<i64, WireError> {
    backend
        .duplicate_flow_item(item_type, item_id, parent_type, parent_id, position)
        .await
}

/// Converts a real Task/Goal subtree into a Flow template of the same Instance Type.
#[tauri::command]
pub async fn convert_to_flow(
    backend: State<'_, AppBackend>,
    node_type: String,
    node_id: i64,
    keep_dependencies: bool,
    map_scopes: bool,
) -> Result<Flow, WireError> {
    backend
        .convert_to_flow(node_type, node_id, keep_dependencies, map_scopes)
        .await
}
