//! Tauri commands for the gestures the app makes over several nodes, each one operation (see
//! [`crate::nodes::gestures`]): one command, so one Gesture and one undo step in either mode.

use tauri::State;

use crate::{
    backend::AppBackend,
    error::WireError,
    nodes::gestures::{steps::StepEntry, GestureName, GestureNode},
};

/// Deletes every node in `nodes`, all or nothing, as one undo step.
#[tauri::command]
pub async fn delete_nodes(
    backend: State<'_, AppBackend>,
    nodes: Vec<GestureNode>,
) -> Result<(), WireError> {
    backend.delete_nodes(nodes).await
}

/// Runs the gesture `name` — its listed writes, in order — as one undo step, answering each
/// write's result. All or nothing, except a write marked `may_be_refused`.
#[tauri::command]
pub async fn run_gesture(
    backend: State<'_, AppBackend>,
    name: GestureName,
    steps: Vec<StepEntry>,
) -> Result<Vec<serde_json::Value>, WireError> {
    backend.run_gesture(name, steps).await
}
