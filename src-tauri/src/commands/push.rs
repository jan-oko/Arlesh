//! Tauri commands for phone push notifications: the page hands the device's FCM token to the
//! server, under the device's own token. Client mode only. See `docs/spec/notifications.md`.

use std::sync::Arc;

use crate::{
    backend::http::{
        push::{PushState, Registered},
        HttpBackend,
    },
    commands::client_mode::ClientModeState,
    error::WireError,
};

fn server(state: &ClientModeState) -> Result<&Arc<HttpBackend>, WireError> {
    state.server().ok_or_else(|| {
        WireError::new(
            crate::error::WireErrorKind::NotPermitted,
            "push notifications come from a server: this device runs Standalone",
            Some(serde_json::json!({ "reason": "not_in_client_mode" })),
        )
    })
}

/// Whether the server can push.
#[tauri::command]
pub async fn push_state(state: tauri::State<'_, ClientModeState>) -> Result<PushState, WireError> {
    server(&state)?.push_state().await
}

/// Registers this device's FCM token with the server.
#[tauri::command]
pub async fn register_push(
    state: tauri::State<'_, ClientModeState>,
    fcm_token: String,
) -> Result<Registered, WireError> {
    server(&state)?.register_push(&fcm_token).await
}

/// Drops this device's push registration.
#[tauri::command]
pub async fn unregister_push(state: tauri::State<'_, ClientModeState>) -> Result<(), WireError> {
    server(&state)?.unregister_push().await
}
