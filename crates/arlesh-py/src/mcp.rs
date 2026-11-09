//! Serving the MCP from the Python process.
//!
//! The desktop app serves `/mcp` itself in local mode. In server mode the FastAPI server
//! (`arlesh-server`) serves it instead: the bindings run the core's own router
//! ([`arlesh_core::mcp::router`]) on their Tokio runtime, over the open database's factory, and
//! FastAPI proxies `/mcp` to it behind its own authentication. So it binds **loopback only** —
//! never a public address — and only a database opened for writing serves it. An agent's writes
//! are then journaled under that database's client.
//!
//! There are no windows to tell about a write, so the board-changed announcement bumps the
//! database's revision instead ([`crate::shared`]), which `GET /events/changes` streams to every device.

use std::net::{IpAddr, SocketAddr};
use std::path::Path;

use arlesh_core::{
    database::session::SessionFactory,
    error::WireErrorKind,
    mcp::{self, ArleshMcp},
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
        return Err(read_only());
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

    // The change feed every open of this file shares, so an agent's writes here reach every
    // device's `GET /events/changes`.
    let shared = crate::shared::for_database(database);
    // The router counts an agent's write into the file's change feed itself, and serves the event
    // streams beside `/mcp`: this host hears of every write, so the waits are not polled.
    let streams = shared.streams();
    let app = mcp::router(factory, arlesh_core::board::silent(), streams);
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

/// The MCP handler of a database opened for writing, answering over the shared state of its file:
/// the change feed an agent's write is counted into. `None` for a read-only
/// database, whose agent could not journal a write.
pub(crate) fn handler(factory: &SessionFactory, database: &Path) -> Option<ArleshMcp> {
    if factory.is_read_only() {
        return None;
    }
    let shared = crate::shared::for_database(database);
    Some(mcp::handler(
        factory.clone(),
        arlesh_core::board::silent(),
        &shared.streams(),
    ))
}

/// The refusal of the MCP on a database that was not opened for writing.
pub(crate) fn read_only() -> Failure {
    Failure::new(
        WireErrorKind::InvalidRequest,
        "only a database opened for writing answers the MCP",
    )
    .with_details(json!({ "reason": "read_only" }))
}
