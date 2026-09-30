//! Tauri's side of the agent capacity lock: the two commands the frontend calls, and the event
//! that tells every window when the lock changes.
//!
//! The lock itself is [`crate::capacity`]. This file is adapter only: an `invoke` becomes a call
//! on it, and a change becomes an event.

use tauri::{Emitter, Manager, Runtime, State};

use crate::{
    board::recipients,
    capacity::{AgentCapacity, CapacityState, Notify},
    error::WireError,
};

/// The Tauri event every window hears when the lock changes, carrying the new
/// [`CapacityState`]. Must match `AGENT_CAPACITY_CHANGED` in `src/api/agent-capacity.ts`.
pub const AGENT_CAPACITY_CHANGED: &str = "agent-capacity-changed";

/// The lock as it stands.
#[tauri::command]
pub async fn agent_capacity(
    capacity: State<'_, AgentCapacity>,
) -> Result<CapacityState, WireError> {
    Ok(capacity.get().await)
}

/// Sets the lock on or off. Every window — this one included — hears the change.
#[tauri::command]
pub async fn set_agent_capacity(
    capacity: State<'_, AgentCapacity>,
    at_capacity: bool,
) -> Result<CapacityState, WireError> {
    capacity
        .set(at_capacity)
        .await
        .map_err(|error| WireError::internal(error.to_string()))
}

/// A [`Notify`] that tells **every** window the lock's new state.
///
/// Every window rather than every window but one, unlike a board change: the payload is the state
/// itself rather than a signal to reload, so hearing it twice costs nothing, and a change can come
/// from the MCP, which is no window at all.
pub fn notifier<R: Runtime>(app: &tauri::AppHandle<R>) -> Notify {
    let app = app.clone();
    std::sync::Arc::new(move |state: CapacityState| {
        let open: Vec<String> = app.webview_windows().into_keys().collect();
        for label in recipients(&open, None) {
            if let Err(error) = app.emit_to(label, AGENT_CAPACITY_CHANGED, state) {
                tracing::warn!(error = %error, label = %label, "could not tell a window the agent capacity lock changed");
            }
        }
    })
}
