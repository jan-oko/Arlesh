//! Tauri commands for pairing a device and the Devices page. See `docs/spec/client-mode.md`,
//! *Pairing a device*.
//!
//! [`pair_start`] and [`pair_poll`] serve the connect screen of a device with no token. Once a
//! poll answers a token, the screen hands it to `connect_to_server`, the same path as pasting one.
//! The rest are for a signed-in device, in Client mode only, and answer through the server.

use std::sync::Arc;

use crate::{
    backend::http::{
        pairing::{self, Approved, Device, PairPolled, PairStarted, WaitingDevice},
        HttpBackend,
    },
    commands::client_mode::ClientModeState,
    error::WireError,
};

/// The name to suggest for this device: the host name, or on Android the phone's model.
#[tauri::command]
pub fn device_name() -> String {
    default_device_name()
}

#[cfg(not(target_os = "android"))]
fn default_device_name() -> String {
    for variable in ["HOSTNAME", "COMPUTERNAME"] {
        if let Ok(name) = std::env::var(variable) {
            if !name.trim().is_empty() {
                return name.trim().to_owned();
            }
        }
    }
    command_output("hostname", &[]).unwrap_or_else(|| "device".to_owned())
}

#[cfg(target_os = "android")]
fn default_device_name() -> String {
    command_output("getprop", &["ro.product.model"]).unwrap_or_else(|| "phone".to_owned())
}

/// What `program` prints, trimmed, or `None` if it cannot be run or printed nothing.
fn command_output(program: &str, arguments: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program)
        .args(arguments)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (output.status.success() && !text.is_empty()).then_some(text)
}

/// Asks the server at `url` for a PIN for this device, which suggests `name`.
#[tauri::command]
pub async fn pair_start(url: String, name: Option<String>) -> Result<PairStarted, WireError> {
    pairing::pair_start(&url, name.as_deref()).await
}

/// Asks the server at `url` whether the request `id` was approved. When it was, the answer
/// carries this device's token, once.
#[tauri::command]
pub async fn pair_poll(url: String, id: String, pin: String) -> Result<PairPolled, WireError> {
    pairing::pair_poll(&url, &id, &pin).await
}

fn server(state: &ClientModeState) -> Result<&Arc<HttpBackend>, WireError> {
    state.server().ok_or_else(|| {
        WireError::new(
            crate::error::WireErrorKind::NotPermitted,
            "devices are managed on a server: this device runs Standalone",
            Some(serde_json::json!({ "reason": "not_in_client_mode" })),
        )
    })
}

/// Every device holding a token on the server.
#[tauri::command]
pub async fn list_devices(
    state: tauri::State<'_, ClientModeState>,
) -> Result<Vec<Device>, WireError> {
    server(&state)?.list_devices().await
}

/// The device showing `pin`: the name it suggests.
#[tauri::command]
pub async fn waiting_device(
    state: tauri::State<'_, ClientModeState>,
    pin: String,
) -> Result<WaitingDevice, WireError> {
    server(&state)?.waiting_device(&pin).await
}

/// Approves the device showing `pin`, under `name` (its suggestion if none).
#[tauri::command]
pub async fn approve_device(
    state: tauri::State<'_, ClientModeState>,
    pin: String,
    name: Option<String>,
) -> Result<Approved, WireError> {
    server(&state)?.approve_device(&pin, name.as_deref()).await
}

/// Revokes a device's token.
#[tauri::command]
pub async fn revoke_device(
    state: tauri::State<'_, ClientModeState>,
    name: String,
) -> Result<(), WireError> {
    server(&state)?.revoke_device(&name).await
}
