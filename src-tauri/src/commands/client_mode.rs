//! Tauri commands for the mode the app runs in: the first-run chooser, Settings → Server, and the
//! top bar's mode and reachability. See `docs/spec/client-mode.md`.
//!
//! Switching mode saves the choice and restarts the app, so each run is wholly one mode: a
//! Standalone run holds the database and serves the MCP, a Client run does neither, and nothing
//! has to be torn down in between.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager, Runtime, State};

use crate::{
    backend::http::{
        compatibility, Connection, Health, HttpBackend, ReadOnlyReason, ServerStatus, StatusNotify,
        API_VERSION,
    },
    board::recipients,
    client_mode::{
        settings::{self, Mode, Startup},
        vault,
    },
    error::WireError,
};

/// The Tauri event every window hears when the server's status changes, carrying the new
/// [`ServerStatus`]. Must match `SERVER_STATUS_CHANGED` in `src/api/client-mode.ts`.
pub const SERVER_STATUS_CHANGED: &str = "server-status-changed";

/// What this run is: its mode, whether to ask the first-run question, and the server's link.
pub struct ClientModeState {
    app_dir: PathBuf,
    mode: Mode,
    first_run: Mutex<bool>,
    server: Option<Arc<HttpBackend>>,
}

impl ClientModeState {
    /// The state of a run started as `startup` says, with `server` in Client mode.
    pub fn new(app_dir: PathBuf, startup: Startup, server: Option<Arc<HttpBackend>>) -> Self {
        Self {
            app_dir,
            mode: startup.mode,
            first_run: Mutex::new(startup.first_run),
            server,
        }
    }

    fn first_run(&self) -> std::sync::MutexGuard<'_, bool> {
        self.first_run
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// What the windows show about the mode.
#[derive(Debug, Clone, Serialize)]
pub struct ModeStatus {
    /// `standalone` or `client`.
    pub mode: &'static str,
    /// Whether to show the first-run chooser.
    pub first_run: bool,
    /// The server, in Client mode.
    pub server: Option<ServerStatus>,
    /// The API version this app speaks.
    pub api_version: u32,
    /// Whether this build can run Standalone.
    pub standalone_available: bool,
}

/// What testing a server found.
#[derive(Debug, Clone, Serialize)]
pub struct ServerCheck {
    /// What its `/health` answered.
    pub health: Health,
    /// Why this app could not write to it, or `None` when it could.
    pub read_only: Option<ReadOnlyReason>,
}

/// The mode, the first-run question and the server's status.
#[tauri::command]
pub fn mode_status(state: State<'_, ClientModeState>) -> ModeStatus {
    ModeStatus {
        mode: match state.mode {
            Mode::Standalone => "standalone",
            Mode::Client { .. } => "client",
        },
        first_run: *state.first_run(),
        server: state.server.as_ref().map(|server| server.status()),
        api_version: API_VERSION,
        standalone_available: cfg!(feature = "standalone"),
    }
}

/// Whether a keychain is there to keep a token in. Without one, the token can be kept in a file
/// only the user can read, once they agree.
#[tauri::command]
pub fn keychain_available() -> bool {
    vault::keychain_available()
}

/// Checks a server before switching to it: that `url` answers, that `token` is one it issued, and
/// which API it speaks. Changes nothing.
#[tauri::command]
pub async fn test_server(url: String, token: String) -> Result<ServerCheck, WireError> {
    let probe = HttpBackend::new(Connection::new(url, token), Arc::new(|_| {}))?;
    let health = probe.check_health().await?;
    Ok(ServerCheck {
        read_only: compatibility(health.api_version),
        health,
    })
}

/// Switches this device to Client mode against `url`: checks the server as [`test_server`] does,
/// keeps `token` (in the keychain, or in the file when `token_in_file`), saves the choice and
/// restarts. A server this app could not write to is refused, naming the side to update.
#[tauri::command]
pub async fn connect_to_server<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, ClientModeState>,
    url: String,
    token: String,
    token_in_file: bool,
) -> Result<(), WireError> {
    let check = test_server(url.clone(), token.clone()).await?;
    if let Some(reason) = check.read_only {
        return Err(crate::backend::http::read_only_error(reason));
    }
    let url = Connection::new(url, "").url;
    vault::store(&state.app_dir, &url, &token, token_in_file)
        .map_err(|error| WireError::internal(error.to_string()))?;
    save(&state, &Mode::Client { url, token_in_file })?;
    app.restart()
}

/// Runs this device Standalone: the first-run chooser's *This device only*, or Settings → Server
/// switching back. Restarts when the app is running as a Client; the local database was left
/// untouched while it was.
#[tauri::command]
pub fn use_standalone<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, ClientModeState>,
) -> Result<(), WireError> {
    save(&state, &Mode::Standalone)?;
    *state.first_run() = false;
    if matches!(state.mode, Mode::Client { .. }) {
        app.restart();
    }
    Ok(())
}

fn save(state: &ClientModeState, mode: &Mode) -> Result<(), WireError> {
    settings::write(&state.app_dir, mode)
        .map_err(|error| WireError::internal(format!("could not save the mode setting: {error}")))
}

/// A [`StatusNotify`] that tells every window the server's new status.
pub fn status_notifier<R: Runtime>(app: &tauri::AppHandle<R>) -> StatusNotify {
    let app = app.clone();
    Arc::new(move |status: &ServerStatus| {
        let open: Vec<String> = app.webview_windows().into_keys().collect();
        for label in recipients(&open, None) {
            if let Err(error) = app.emit_to(label, SERVER_STATUS_CHANGED, status) {
                tracing::warn!(error = %error, label = %label, "could not tell a window the server's status");
            }
        }
    })
}

/// Holds no connection while the app is in the background: the change stream stops when the app is
/// suspended and is followed again, `/health` checked, when it is resumed. Standalone has no
/// stream to stop, and so no `Follower` to find.
#[cfg(mobile)]
pub fn on_lifecycle<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    let Some(follower) = window.app_handle().try_state::<crate::backend::http::events::Follower>() else {
        return;
    };
    match event {
        tauri::WindowEvent::Suspended => follower.suspend(),
        tauri::WindowEvent::Resumed => follower.resume(),
        _ => {}
    }
}
