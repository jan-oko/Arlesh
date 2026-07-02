//! Tauri commands for flow operations.

use tauri::State;

use crate::{
    database::DatabasePool,
    flows::{
        model::{
            CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCycleInput, FlowDependency,
            FlowGoal, FlowId, FlowItemCycle, FlowItemType, FlowTask, MaterializedFlow,
            StartFlowRequest, UpdateFlowItemRequest, UpdateFlowRequest,
        },
        FlowRepository,
    },
};

/// Creates a new flow.
#[tauri::command]
pub async fn create_flow(
    pool: State<'_, DatabasePool>,
    request: CreateFlowRequest,
) -> Result<Flow, String> {
    FlowRepository::new(&pool)
        .create(request)
        .await
        .map_err(|error| error.to_string())
}

/// Fetches a flow by id.
#[tauri::command]
pub async fn get_flow(pool: State<'_, DatabasePool>, id: i64) -> Result<Flow, String> {
    FlowRepository::new(&pool)
        .get(FlowId(id))
        .await
        .map_err(|error| error.to_string())
}

/// Lists all flows.
#[tauri::command]
pub async fn list_flows(pool: State<'_, DatabasePool>) -> Result<Vec<Flow>, String> {
    FlowRepository::new(&pool)
        .list()
        .await
        .map_err(|error| error.to_string())
}

/// Updates a flow.
#[tauri::command]
pub async fn update_flow(
    pool: State<'_, DatabasePool>,
    id: i64,
    request: UpdateFlowRequest,
) -> Result<Flow, String> {
    FlowRepository::new(&pool)
        .update(FlowId(id), request)
        .await
        .map_err(|error| error.to_string())
}

/// Deletes a flow (and its items).
#[tauri::command]
pub async fn delete_flow(pool: State<'_, DatabasePool>, id: i64) -> Result<(), String> {
    FlowRepository::new(&pool)
        .delete(FlowId(id))
        .await
        .map_err(|error| error.to_string())
}

/// Creates a flow-goal item.
#[tauri::command]
pub async fn create_flow_goal(
    pool: State<'_, DatabasePool>,
    request: CreateFlowItemRequest,
) -> Result<FlowGoal, String> {
    FlowRepository::new(&pool)
        .create_goal(request)
        .await
        .map_err(|error| error.to_string())
}

/// Creates a flow-task item.
#[tauri::command]
pub async fn create_flow_task(
    pool: State<'_, DatabasePool>,
    request: CreateFlowItemRequest,
) -> Result<FlowTask, String> {
    FlowRepository::new(&pool)
        .create_task(request)
        .await
        .map_err(|error| error.to_string())
}

/// Lists a flow's goal items.
#[tauri::command]
pub async fn list_flow_goals(
    pool: State<'_, DatabasePool>,
    flow_id: i64,
) -> Result<Vec<FlowGoal>, String> {
    FlowRepository::new(&pool)
        .list_goals(FlowId(flow_id))
        .await
        .map_err(|error| error.to_string())
}

/// Lists a flow's task items.
#[tauri::command]
pub async fn list_flow_tasks(
    pool: State<'_, DatabasePool>,
    flow_id: i64,
) -> Result<Vec<FlowTask>, String> {
    FlowRepository::new(&pool)
        .list_tasks(FlowId(flow_id))
        .await
        .map_err(|error| error.to_string())
}

/// Lists every flow's goal items.
#[tauri::command]
pub async fn list_all_flow_goals(pool: State<'_, DatabasePool>) -> Result<Vec<FlowGoal>, String> {
    FlowRepository::new(&pool)
        .list_all_goals()
        .await
        .map_err(|error| error.to_string())
}

/// Lists every flow's task items.
#[tauri::command]
pub async fn list_all_flow_tasks(pool: State<'_, DatabasePool>) -> Result<Vec<FlowTask>, String> {
    FlowRepository::new(&pool)
        .list_all_tasks()
        .await
        .map_err(|error| error.to_string())
}

/// Updates a flow-goal item.
#[tauri::command]
pub async fn update_flow_goal(
    pool: State<'_, DatabasePool>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowGoal, String> {
    FlowRepository::new(&pool)
        .update_goal(id, request)
        .await
        .map_err(|error| error.to_string())
}

/// Updates a flow-task item.
#[tauri::command]
pub async fn update_flow_task(
    pool: State<'_, DatabasePool>,
    id: i64,
    request: UpdateFlowItemRequest,
) -> Result<FlowTask, String> {
    FlowRepository::new(&pool)
        .update_task(id, request)
        .await
        .map_err(|error| error.to_string())
}

/// Starts a flow, materialising it into a real subtree under the target.
#[tauri::command]
pub async fn start_flow(
    pool: State<'_, DatabasePool>,
    flow_id: i64,
    request: StartFlowRequest,
) -> Result<MaterializedFlow, String> {
    FlowRepository::new(&pool)
        .start(FlowId(flow_id), request)
        .await
        .map_err(|error| error.to_string())
}

/// Converts a flow item to the other kind (goal↔task), preserving its cycles and dependencies.
#[tauri::command]
pub async fn convert_flow_item(
    pool: State<'_, DatabasePool>,
    from_type: FlowItemType,
    id: i64,
    to_type: FlowItemType,
    status: String,
) -> Result<i64, String> {
    FlowRepository::new(&pool)
        .convert_item(from_type, id, to_type, &status)
        .await
        .map_err(|error| error.to_string())
}

/// Deletes a flow item (goal or task) and its cycles and dependency links.
#[tauri::command]
pub async fn delete_flow_item(
    pool: State<'_, DatabasePool>,
    item_type: FlowItemType,
    id: i64,
) -> Result<(), String> {
    FlowRepository::new(&pool)
        .delete_item(item_type, id)
        .await
        .map_err(|error| error.to_string())
}

/// Replaces a flow item's (Cycle Scope, Cycle Plan) pairs.
#[tauri::command]
pub async fn set_flow_item_cycles(
    pool: State<'_, DatabasePool>,
    flow_id: i64,
    item_type: FlowItemType,
    item_id: i64,
    cycles: Vec<FlowCycleInput>,
) -> Result<(), String> {
    FlowRepository::new(&pool)
        .set_cycles(flow_id, item_type, item_id, &cycles)
        .await
        .map_err(|error| error.to_string())
}

/// Lists every flow's cycle pairs.
#[tauri::command]
pub async fn list_all_flow_cycles(
    pool: State<'_, DatabasePool>,
) -> Result<Vec<FlowItemCycle>, String> {
    FlowRepository::new(&pool)
        .list_all_cycles()
        .await
        .map_err(|error| error.to_string())
}

/// Adds an intra-flow dependency (`dependent` waits on `depends_on`).
#[tauri::command]
pub async fn add_flow_dependency(
    pool: State<'_, DatabasePool>,
    flow_id: i64,
    dependent_type: FlowItemType,
    dependent_id: i64,
    depends_on_type: FlowItemType,
    depends_on_id: i64,
) -> Result<(), String> {
    FlowRepository::new(&pool)
        .add_dependency(flow_id, dependent_type, dependent_id, depends_on_type, depends_on_id)
        .await
        .map_err(|error| error.to_string())
}

/// Removes an intra-flow dependency.
#[tauri::command]
pub async fn remove_flow_dependency(
    pool: State<'_, DatabasePool>,
    dependent_type: FlowItemType,
    dependent_id: i64,
    depends_on_type: FlowItemType,
    depends_on_id: i64,
) -> Result<(), String> {
    FlowRepository::new(&pool)
        .remove_dependency(dependent_type, dependent_id, depends_on_type, depends_on_id)
        .await
        .map_err(|error| error.to_string())
}

/// Lists every flow's dependencies.
#[tauri::command]
pub async fn list_all_flow_dependencies(
    pool: State<'_, DatabasePool>,
) -> Result<Vec<FlowDependency>, String> {
    FlowRepository::new(&pool)
        .list_all_dependencies()
        .await
        .map_err(|error| error.to_string())
}
