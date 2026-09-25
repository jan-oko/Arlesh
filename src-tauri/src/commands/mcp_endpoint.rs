//! Tauri commands for the MCP endpoint's listener: its status, a restart, and its port.

use tauri::State;

use crate::{
    error::WireError,
    mcp::endpoint::{EndpointError, EndpointStatus, McpEndpoint},
};

/// The listener as it stands: listening on which address, or failed and why.
#[tauri::command]
pub async fn mcp_endpoint_status(
    endpoint: State<'_, McpEndpoint>,
) -> Result<EndpointStatus, WireError> {
    Ok(endpoint.status().await)
}

/// Binds the listener again on the current port. A bind failure is in the status, not an error.
#[tauri::command]
pub async fn restart_mcp_endpoint(
    endpoint: State<'_, McpEndpoint>,
) -> Result<EndpointStatus, WireError> {
    Ok(endpoint.restart().await)
}

/// Saves `port` as the MCP port and moves the listener onto it.
#[tauri::command]
pub async fn set_mcp_port(
    endpoint: State<'_, McpEndpoint>,
    port: u16,
) -> Result<EndpointStatus, WireError> {
    endpoint.set_port(port).await.map_err(|error| match error {
        EndpointError::InvalidPort => WireError::invalid_request(error.to_string()),
        EndpointError::Save(_) => WireError::internal(error.to_string()),
    })
}
