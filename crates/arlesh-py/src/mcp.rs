//! Serving the MCP endpoint from the Python process.
//!
//! The desktop app serves `/mcp` itself in local mode. In server mode the FastAPI server
//! (`arlesh-server`) serves it instead: the bindings run the core's own router
//! ([`arlesh_core::mcp::router`]) on their Tokio runtime, over the open database's factory, and
//! FastAPI proxies `/mcp` to it behind its own authentication. So it binds **loopback only** —
//! never a public address — and only a database opened for writing serves it. An agent's writes
//! are then journaled under that database's client.
//!
//! There are no windows to tell about a write, so the board-changed announcement is silent. The
//! agent capacity lock is the same file the app keeps beside the database (`agent-capacity.json`
//! in its directory), with no one to notify of a change.

use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::Arc;

use arlesh_core::{
    board,
    capacity::{AgentCapacity, CAPACITY_FILE},
    database::session::SessionFactory,
    error::WireErrorKind,
    mcp,
};
use serde_json::json;
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};

use crate::errors::Failure;

/// A running endpoint: how to stop it, and the task serving it.
pub(crate) struct Serving {
    /// Ends the serve loop gracefully when sent (or dropped).
    stop: oneshot::Sender<()>,
    /// The serve loop, to wait for once it is told to stop.
    task: JoinHandle<()>,
}

impl Serving {
    /// Stops serving and waits for the listener to close.
    pub(crate) async fn stop(self) {
        // A send fails only when the loop already ended, which is what stopping asks for.
        let _ = self.stop.send(());
        if let Err(error) = self.task.await {
            tracing::warn!(error = %error, "the MCP serve task ended abnormally");
        }
    }
}

/// Binds `host:port` (a loopback address; port 0 picks a free one) and serves the MCP endpoint
/// over `factory` there. Answers the bound port and the running endpoint.
pub(crate) async fn serve(
    factory: SessionFactory,
    database: &Path,
    host: &str,
    port: u16,
) -> Result<(u16, Serving), Failure> {
    if factory.is_read_only() {
        return Err(Failure::new(
            WireErrorKind::InvalidRequest,
            "only a database opened for writing serves the MCP endpoint",
        )
        .with_details(json!({ "reason": "read_only" })));
    }
    let address = loopback(host, port)?;
    let listener = TcpListener::bind(address).await.map_err(|error| {
        Failure::new(
            WireErrorKind::Internal,
            format!("could not bind the MCP endpoint on {address}: {error}"),
        )
        .with_details(json!({ "reason": "bind_failed" }))
    })?;
    let bound = listener
        .local_addr()
        .map_err(|error| Failure::new(WireErrorKind::Internal, error.to_string()))?
        .port();

    let capacity = AgentCapacity::open(capacity_file(database), Arc::new(|_| {}));
    let app = mcp::router(factory, board::silent(), capacity);
    let (stop, stopped) = oneshot::channel::<()>();
    let task = tokio::spawn(async move {
        let shutdown = async {
            // Stopping is either a send or the sender going away with the database.
            let _ = stopped.await;
        };
        if let Err(error) = axum::serve(listener, app)
            .with_graceful_shutdown(shutdown)
            .await
        {
            tracing::error!(error = %error, "the MCP endpoint stopped serving");
        }
    });
    tracing::info!(port = bound, "MCP endpoint serving");
    Ok((bound, Serving { stop, task }))
}

/// `host:port`, refused unless `host` is a loopback address.
fn loopback(host: &str, port: u16) -> Result<SocketAddr, Failure> {
    let ip: IpAddr = host.parse().map_err(|_| refuse_host(host))?;
    if !ip.is_loopback() {
        return Err(refuse_host(host));
    }
    Ok(SocketAddr::new(ip, port))
}

/// The refusal of a host that is not a loopback address.
fn refuse_host(host: &str) -> Failure {
    Failure::new(
        WireErrorKind::InvalidRequest,
        format!("the MCP endpoint binds a loopback address only, not {host:?}"),
    )
    .with_details(json!({ "reason": "not_loopback" }))
}

/// The agent capacity lock beside the database at `database`: the file the app keeps.
pub(crate) fn capacity_file(database: &Path) -> std::path::PathBuf {
    database
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(CAPACITY_FILE)
}
