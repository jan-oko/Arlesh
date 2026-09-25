//! The MCP endpoint's listener: which port it binds, whether it is listening, and moving it.
//!
//! The port is the user's setting — saved beside the window session in the app's data directory,
//! [`SETTINGS_FILE`] — unless `ARLESH_MCP_PORT` overrides it. It is a property of this machine,
//! not of the board, so it is a file rather than a row: a row would be journaled, and Ctrl+Z would
//! move the listener.
//!
//! A port that cannot be bound — most often because another Arlesh already holds it — is an
//! ordinary condition, not a reason to take the app down, so it is recorded as the listener's
//! [`ListenerState::Failed`] state with the reason, for the settings page to show. The page can
//! then [`McpEndpoint::restart`] the listener, or move it with [`McpEndpoint::set_port`], without
//! restarting the app. See `docs/spec/mcp-server.md`, "Address".

use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use tokio::{net::TcpListener, sync::Mutex, task::JoinHandle};

use super::{router, DEFAULT_PORT, PORT_ENV_VAR};
use crate::{board::Announce, database::session::SessionFactory};

/// The file in the app's data directory that holds the MCP port setting.
pub const SETTINGS_FILE: &str = "mcp.json";

/// What the listener is doing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ListenerState {
    /// Not bound yet: the first start has not finished.
    Starting,
    /// Bound and serving.
    Listening {
        /// The address it serves on, e.g. `127.0.0.1:4747`.
        address: String,
    },
    /// The port could not be bound; nothing is serving.
    Failed {
        /// Why, as the operating system put it — e.g. the address is already in use.
        reason: String,
    },
}

/// The endpoint as the settings page shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EndpointStatus {
    /// What the listener is doing.
    pub listener: ListenerState,
    /// The port the listener last tried: the override when one is set, else the setting.
    pub port: u16,
    /// The port the user chose, or the default when they never chose one.
    pub configured_port: u16,
    /// The port `ARLESH_MCP_PORT` sets, which wins over the setting while it is set.
    pub env_override: Option<u16>,
}

/// A port change that could not be made.
#[derive(Debug, thiserror::Error)]
pub enum EndpointError {
    /// Port 0 asks the system for any free port, which no client could be told in advance.
    #[error("port 0 cannot be used for the MCP; choose a port from 1 to 65535")]
    InvalidPort,
    /// The setting could not be written.
    #[error("could not save the MCP port: {0}")]
    Save(#[from] std::io::Error),
}

/// The settings file's contents.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Settings {
    /// The chosen port, when the user chose one.
    #[serde(default)]
    port: Option<u16>,
}

/// The port saved at `path`, or `None` when there is none — no file, or one that cannot be read,
/// which is logged and read as no choice rather than failing the start.
pub fn read_port_setting(path: &Path) -> Option<u16> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            tracing::warn!(error = %error, path = %path.display(), "could not read the MCP settings");
            return None;
        }
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(settings) => settings.port.filter(|port| *port != 0),
        Err(error) => {
            tracing::warn!(error = %error, path = %path.display(), "ignoring unreadable MCP settings");
            None
        }
    }
}

/// Saves `port` as the setting at `path`.
fn write_port_setting(path: &Path, port: u16) -> Result<(), std::io::Error> {
    let settings = Settings { port: Some(port) };
    let text = serde_json::to_string_pretty(&settings).map_err(std::io::Error::other)?;
    std::fs::write(path, text)
}

/// The port `ARLESH_MCP_PORT` sets, when it is set and parseable.
///
/// An unparseable value is a typo in the user's environment, not a reason to refuse to start, so
/// it warns and is ignored.
pub fn env_port() -> Option<u16> {
    let raw = std::env::var(PORT_ENV_VAR).ok()?;
    match raw.parse::<u16>() {
        Ok(port) if port != 0 => Some(port),
        Ok(_) => {
            tracing::warn!(value = %raw, "ignoring MCP port override 0");
            None
        }
        Err(error) => {
            tracing::warn!(value = %raw, error = %error, "ignoring unparseable MCP port override");
            None
        }
    }
}

/// The MCP endpoint's listener, shared by the app's setup and the settings commands.
#[derive(Clone)]
pub struct McpEndpoint {
    inner: Arc<Inner>,
}

struct Inner {
    factory: SessionFactory,
    announce: Announce,
    settings: PathBuf,
    env_override: Option<u16>,
    running: Mutex<Running>,
}

/// The listener as it stands, behind one lock so two restarts cannot interleave.
struct Running {
    state: ListenerState,
    port: u16,
    server: Option<JoinHandle<()>>,
}

impl McpEndpoint {
    /// An endpoint over `factory` whose port setting lives at `settings`, overridden by
    /// `env_override` when set (the app passes [`env_port`]). Nothing is bound until
    /// [`McpEndpoint::restart`].
    pub fn new(
        factory: SessionFactory,
        announce: Announce,
        settings: PathBuf,
        env_override: Option<u16>,
    ) -> Self {
        let port =
            env_override.unwrap_or_else(|| read_port_setting(&settings).unwrap_or(DEFAULT_PORT));
        Self {
            inner: Arc::new(Inner {
                factory,
                announce,
                settings,
                env_override,
                running: Mutex::new(Running {
                    state: ListenerState::Starting,
                    port,
                    server: None,
                }),
            }),
        }
    }

    /// The port the user chose, or the default.
    fn configured_port(&self) -> u16 {
        read_port_setting(&self.inner.settings).unwrap_or(DEFAULT_PORT)
    }

    /// The listener as it stands.
    pub async fn status(&self) -> EndpointStatus {
        let running = self.inner.running.lock().await;
        self.status_of(&running)
    }

    fn status_of(&self, running: &Running) -> EndpointStatus {
        EndpointStatus {
            listener: running.state.clone(),
            port: running.port,
            configured_port: self.configured_port(),
            env_override: self.inner.env_override,
        }
    }

    /// Stops the listener, if one is serving, and binds again on the current port — the override
    /// when set, else the setting. A bind failure is the returned status's reason, never an error.
    #[tracing::instrument(skip(self))]
    pub async fn restart(&self) -> EndpointStatus {
        let mut running = self.inner.running.lock().await;
        if let Some(server) = running.server.take() {
            server.abort();
            // Awaited so the old listener is dropped — and its port free — before the bind below.
            let _cancelled = server.await;
        }

        let port = self
            .inner
            .env_override
            .unwrap_or_else(|| self.configured_port());
        let address = SocketAddr::from(([127, 0, 0, 1], port));
        running.port = port;
        match TcpListener::bind(address).await {
            Ok(listener) => {
                tracing::info!(%address, "MCP endpoint listening at /mcp");
                let app = router(self.inner.factory.clone(), self.inner.announce.clone());
                running.server = Some(tokio::spawn(async move {
                    if let Err(error) = axum::serve(listener, app).await {
                        tracing::error!(error = %error, "MCP endpoint stopped");
                    }
                }));
                running.state = ListenerState::Listening {
                    address: address.to_string(),
                };
            }
            Err(error) => {
                tracing::warn!(
                    %address,
                    error = %error,
                    "MCP endpoint not started; Arlesh runs without it"
                );
                running.state = ListenerState::Failed {
                    reason: error.to_string(),
                };
            }
        }
        self.status_of(&running)
    }

    /// Saves `port` as the setting and moves the listener onto it. While `ARLESH_MCP_PORT` is set
    /// the setting is saved but the override keeps the listener where it is.
    pub async fn set_port(&self, port: u16) -> Result<EndpointStatus, EndpointError> {
        if port == 0 {
            return Err(EndpointError::InvalidPort);
        }
        write_port_setting(&self.inner.settings, port)?;
        Ok(self.restart().await)
    }
}
