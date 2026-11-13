//! Tauri's side of the agents: the commands Settings → Agents calls, and the PIN door the app
//! keeps on its loopback port for the agents on this machine.
//!
//! The Agents, Claims and accounts are [`crate::agents`]; this file is adapter only. In Client mode
//! the calls go to the server through the backend, so the list is the server's.

use tauri::{Emitter, Manager, Runtime, State};

use crate::{
    agents::model::{AgentAction, AgentsOverview, IssuedPin},
    backend::AppBackend,
    error::WireError,
    mcp::door::PinIssuer,
};

/// The Tauri event every window hears when the agents change (an agent attached, a Claim moved,
/// a lock flipped). It carries nothing: the window reads the list again. Must match
/// `AGENTS_CHANGED` in `src/api/agents.ts`.
pub const AGENTS_CHANGED: &str = "agents-changed";

/// Every Agent and account, with where each Claim stands and why an agent is at capacity.
#[tauri::command]
pub async fn list_agents(backend: State<'_, AppBackend>) -> Result<AgentsOverview, WireError> {
    backend.list_agents().await
}

/// A one-time PIN to give an agent, so it can attach.
#[tauri::command]
pub async fn issue_agent_pin<R: Runtime>(
    app: tauri::AppHandle<R>,
    backend: State<'_, AppBackend>,
) -> Result<IssuedPin, WireError> {
    let pin = backend.issue_agent_pin().await?;
    tell_windows(&app);
    Ok(pin)
}

/// Changes an Agent by hand: pauses, resumes or releases its Claim, locks it, removes it.
#[tauri::command]
pub async fn apply_agent_action<R: Runtime>(
    app: tauri::AppHandle<R>,
    backend: State<'_, AppBackend>,
    id: i64,
    action: AgentAction,
) -> Result<(), WireError> {
    backend.apply_agent_action(id, action).await?;
    tell_windows(&app);
    Ok(())
}

/// Locks or unlocks a whole account by hand.
#[tauri::command]
pub async fn set_agent_account_locked<R: Runtime>(
    app: tauri::AppHandle<R>,
    backend: State<'_, AppBackend>,
    label: String,
    locked: bool,
) -> Result<(), WireError> {
    backend.set_agent_account_locked(label, locked).await?;
    tell_windows(&app);
    Ok(())
}

/// Tells every window the agents changed.
pub fn tell_windows<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Err(error) = app.emit(AGENTS_CHANGED, ()) {
        tracing::warn!(error = %error, "could not tell the windows the agents changed");
    }
}

/// The PIN door's issuer over the app's backend: in Standalone mode a PIN from the local file, in
/// Client mode one from the server, asked with the app's own device token.
pub fn pin_issuer<R: Runtime>(app: &tauri::AppHandle<R>) -> PinIssuer {
    let app = app.clone();
    std::sync::Arc::new(move || {
        let app = app.clone();
        Box::pin(async move {
            let backend = app.state::<AppBackend>();
            let pin = backend.issue_agent_pin().await?;
            tell_windows(&app);
            Ok(pin)
        })
    })
}

/// Serves the PIN door on the MCP port (the setting, or the override) in Client mode, where there
/// is no MCP endpoint to carry it. A port already taken is a warning, not a failure: agents then
/// ask the user for a PIN from Settings → Agents.
pub fn serve_pin_door<R: Runtime>(app: &tauri::AppHandle<R>, app_dir: &std::path::Path) {
    let port = crate::mcp::endpoint::env_port().unwrap_or_else(|| {
        crate::mcp::endpoint::read_port_setting(&app_dir.join(crate::mcp::endpoint::SETTINGS_FILE))
            .unwrap_or(crate::mcp::DEFAULT_PORT)
    });
    let router = crate::mcp::door::router(pin_issuer(app));
    tauri::async_runtime::spawn(async move {
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        match tokio::net::TcpListener::bind(address).await {
            Ok(listener) => {
                tracing::info!(%address, "PIN door listening at /agents/pin");
                if let Err(error) = axum::serve(listener, router).await {
                    tracing::error!(error = %error, "the PIN door stopped");
                }
            }
            Err(error) => {
                tracing::warn!(%address, error = %error, "the PIN door is not served: agents will need a PIN from Settings");
            }
        }
    });
}
