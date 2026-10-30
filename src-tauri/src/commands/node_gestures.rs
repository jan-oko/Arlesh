//! Tauri commands for the gestures the app makes over several nodes, each one operation (see
//! [`crate::nodes::gestures`]): one command, so one Gesture and one undo step in either mode.

use tauri::State;

use crate::{backend::AppBackend, error::WireError, nodes::gestures::GestureNode};

/// Deletes every node in `nodes`, all or nothing, as one undo step.
#[tauri::command]
pub async fn delete_nodes(
    backend: State<'_, AppBackend>,
    nodes: Vec<GestureNode>,
) -> Result<(), WireError> {
    backend.delete_nodes(nodes).await
}
