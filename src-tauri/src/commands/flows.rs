//! Tauri commands for flow operations.

use tauri::State;

use crate::{
    database::DatabasePool,
    flows::{
        model::{
            CreateFlowItemRequest, CreateFlowRequest, Flow, FlowGoal, FlowId, FlowTask,
            UpdateFlowRequest,
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
