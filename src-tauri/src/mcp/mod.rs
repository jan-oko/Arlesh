//! MCP server exposing Arlesh's reads to an agent.
//!
//! A second adapter over the session layer, sibling to [`commands`](crate::commands): both open a
//! session from the same [`SessionFactory`] and delegate to the same stateless resource operators,
//! and neither depends on the other. The Tauri commands serve the app's own frontend; these tools
//! serve an MCP client — Claude Code, Claude Desktop — over localhost HTTP.
//!
//! # Shape of the surface
//!
//! Six tools rather than one per command. [`ArleshMcp::snapshot`] returns the whole planning
//! graph in one payload, so the read tools beside it exist only for what it does not carry: scope
//! resolution, the knowledge base, and the handful of per-item and what-if reads. An MCP client
//! pays context for every tool definition it loads, which is why the surface is grouped rather
//! than mirrored.
//!
//! # Reads and the one write
//!
//! [`ArleshMcp::beads`] is the one tool that writes something the user sees: it sets the `bd`
//! issue id on a Task, Goal or Project, and is the only way that field can be set at all. Every
//! other tool is annotated `read_only_hint = true` except [`ArleshMcp::snapshot`], which is not
//! read-only and says so: deriving a Habit's iterations materialises the scope rows its
//! windows land on, so the snapshot opens a transactional session and commits. Those writes create
//! no user content — no task, goal or flow — and are the same rows the mindmap materialises on its
//! next load. Running the snapshot uncommitted would make it a pure read, but its habit iterations
//! reference the scope ids it mints, so the payload would hand out ids that no longer resolve.
//!
//! See `docs/superpowers/specs/2026-09-16-mcp-server-design.md`.

mod beads;
mod flows;
mod kb;
pub mod params;
mod result;
mod scopes;
mod snapshot;
mod tasks;

use std::sync::Arc;

use rmcp::{
    handler::server::tool::ToolRouter,
    tool_handler,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ServerHandler,
};

use crate::database::session::SessionFactory;

/// The default localhost port the MCP endpoint binds to.
pub const DEFAULT_PORT: u16 = 4747;

/// Environment variable overriding [`DEFAULT_PORT`].
pub const PORT_ENV_VAR: &str = "ARLESH_MCP_PORT";

/// The MCP tool handler. Holds a [`SessionFactory`] and nothing else — every tool opens its own
/// session per call, exactly as a command does.
#[derive(Clone)]
pub struct ArleshMcp {
    factory: SessionFactory,
    tool_router: ToolRouter<Self>,
}

impl ArleshMcp {
    /// Builds a handler over `factory`, combining the per-resource tool routers.
    ///
    /// Each tool module declares its own router so that a tool lives in one file with the types it
    /// needs; they are summed here, which is also the single place a new tool has to be added.
    pub fn new(factory: SessionFactory) -> Self {
        Self {
            factory,
            tool_router: Self::snapshot_router()
                + Self::scopes_router()
                + Self::kb_router()
                + Self::tasks_router()
                + Self::flows_router()
                + Self::beads_router(),
        }
    }

    /// The names of every registered tool.
    ///
    /// Exists so a test can catch a router dropped from the sum in [`ArleshMcp::new`] — a tool
    /// that silently stops being served is otherwise invisible until an agent asks for it.
    pub fn tool_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .tool_router
            .list_all()
            .into_iter()
            .map(|tool| tool.name.to_string())
            .collect();
        names.sort();
        names
    }
}

// `instructions` is what an agent reads before it calls anything, so it points at the
// snapshot and at the one thing the payload does not make obvious: windows are scope IDs.
#[tool_handler(
    router = self.tool_router,
    name = "arlesh",
    instructions = "Arlesh's task-management and knowledge-base data, read-only. Start with arlesh_snapshot.load, which returns the whole planning graph — tasks, goals, flows, domains, dependencies and derived lifecycles — in one call. Tasks and goals carry their windows as boundary scope IDs, not dates: resolve them with arlesh_scopes.resolve_many. The other tools cover what the snapshot omits."
)]
impl ServerHandler for ArleshMcp {}

/// The port the endpoint binds to: [`PORT_ENV_VAR`] when set and parseable, else [`DEFAULT_PORT`].
///
/// An unparseable value is a typo in the user's environment, not a reason to refuse to start, so
/// it warns and falls back.
pub fn port() -> u16 {
    match std::env::var(PORT_ENV_VAR) {
        Err(_) => DEFAULT_PORT,
        Ok(raw) => match raw.parse() {
            Ok(port) => port,
            Err(error) => {
                tracing::warn!(
                    value = %raw,
                    error = %error,
                    default = DEFAULT_PORT,
                    "ignoring unparseable MCP port override"
                );
                DEFAULT_PORT
            }
        },
    }
}

/// Builds the axum router serving the MCP endpoint at `/mcp`.
fn router(factory: SessionFactory) -> axum::Router {
    // `allowed_hosts` already defaults to loopback only. `allowed_origins` defaults to empty,
    // which *disables* Origin validation rather than enforcing it — so a page in the user's
    // browser could POST here. `enforce_origin_validation` rejects any request that carries an
    // Origin at all, which a browser always does and an MCP client never does.
    let config = StreamableHttpServerConfig::default().enforce_origin_validation();

    let service = StreamableHttpService::new(
        move || Ok(ArleshMcp::new(factory.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );

    axum::Router::new().nest_service("/mcp", service)
}

/// Serves the MCP endpoint on localhost until the process ends.
///
/// A bind failure is logged and swallowed: an occupied port is an ordinary condition, and the app
/// is still fully usable without an agent attached. Returning an error here would propagate into
/// Tauri's `setup` and take the whole window down with it.
pub async fn serve(factory: SessionFactory) {
    let port = port();
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));

    let listener = match tokio::net::TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::warn!(
                %address,
                error = %error,
                env_var = PORT_ENV_VAR,
                "MCP endpoint not started; Arlesh runs without it"
            );
            return;
        }
    };

    tracing::info!(%address, "MCP endpoint listening at /mcp");

    if let Err(error) = axum::serve(listener, router(factory)).await {
        tracing::error!(error = %error, "MCP endpoint stopped");
    }
}
