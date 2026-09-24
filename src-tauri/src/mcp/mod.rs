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
//! other tool, [`ArleshMcp::snapshot`] included, is annotated `read_only_hint = true` and writes
//! nothing. The snapshot used to be the exception — deriving a Habit's iterations minted the scope
//! rows their windows landed on — until scopes became derived values (ADR 0009).
//!
//! # Access
//!
//! The MCP sees only the **MCP roots** the user chose, and nothing at all until they choose one:
//! every tool reads the roots afresh, omits what lies outside them from what it returns, and
//! refuses a request naming such a node as `not_permitted`. Private nodes stay hidden inside a
//! root, and only an Agentic Task inside one can be written. The roots themselves are named in
//! the instructions each connection receives. See [`access`] and [`crate::access`].
//!
//! See `docs/superpowers/specs/2026-09-16-mcp-server-design.md`.

mod access;
mod beads;
mod flows;
mod kb;
pub mod paging;
pub mod params;
mod result;
mod scopes;
mod snapshot;
mod tasks;

use std::sync::Arc;

use rmcp::{
    handler::server::tool::ToolRouter,
    model::{InitializeRequestParams, InitializeResult},
    service::RequestContext,
    tool_handler,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData, RoleServer, ServerHandler,
};

use crate::board::{self, Announce};
use crate::database::session::SessionFactory;

/// The default localhost port the MCP endpoint binds to.
pub const DEFAULT_PORT: u16 = 4747;

/// Environment variable overriding [`DEFAULT_PORT`].
pub const PORT_ENV_VAR: &str = "ARLESH_MCP_PORT";

/// The MCP tool handler. Holds a [`SessionFactory`] and a way to say the board changed — every
/// tool opens its own session per call, exactly as a command does.
#[derive(Clone)]
pub struct ArleshMcp {
    factory: SessionFactory,
    /// Told after the one tool that writes has committed, so an open window catches up.
    ///
    /// A closure rather than an `AppHandle`, so that nothing in this module has to know what a
    /// window is — an agent's write is not made *in* a window, and every window needs telling.
    announce: Announce,
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
            // Silent until [`ArleshMcp::announcing`] says otherwise, so a handler built by a test
            // — which has no windows — needs no ceremony to stand up.
            announce: board::silent(),
            tool_router: Self::snapshot_router()
                + Self::scopes_router()
                + Self::kb_router()
                + Self::tasks_router()
                + Self::flows_router()
                + Self::beads_router(),
        }
    }

    /// Gives this handler somewhere to send a board change.
    ///
    /// Separate from [`ArleshMcp::new`] rather than an argument to it, because it is the running
    /// app's business and no test's: every integration test builds a handler over a pool, and
    /// none of them has a window to tell.
    pub fn announcing(mut self, announce: Announce) -> Self {
        self.announce = announce;
        self
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

    /// The instructions an agent is given on connecting: the fixed guide to the tools, then the
    /// MCP roots this connection can see.
    ///
    /// Read per connection rather than cached, so a root added or removed — or retitled — is in
    /// the next session's instructions without anything having to say it changed. A failure to
    /// read the roots is logged and said in the text rather than failing the handshake: an agent
    /// told nothing about its roots still gets the tools, and every tool reads the roots afresh
    /// anyway.
    pub async fn instructions(&self) -> String {
        let base = self.get_info().instructions.unwrap_or_default();
        let roots = match self.roots_instructions().await {
            Ok(roots) => roots,
            Err(error) => {
                tracing::warn!(error = %error, "could not read the MCP roots for the instructions");
                "MCP ROOTS: could not be read just now. Every tool still applies them; a request \
                 naming a node outside them is refused as not_permitted."
                    .to_string()
            }
        };
        format!("{base}\n\n{roots}")
    }

    async fn roots_instructions(&self) -> Result<String, crate::error::AppError> {
        let mut db = self.factory.connect().await?;
        let nodes = db.access().catalogue().await?;
        let roots = db.access().roots().await?;
        let stored: Vec<_> = nodes
            .iter()
            .map(crate::access::model::CatalogueNode::stored)
            .collect();
        let map = crate::access::resolve::AccessMap::resolve(&stored, &roots);
        Ok(access::roots_instructions(&nodes, &roots, &map))
    }
}

// `instructions` is what an agent reads before it calls anything, so it points at the snapshot,
// says the snapshot is paged — an agent that stops after one page silently sees a fraction of the
// board — and names the one thing the payload does not make obvious: windows are scope IDs. The
// MCP roots are appended per connection by `initialize` below, since they are the user's to change.
#[tool_handler(
    router = self.tool_router,
    name = "arlesh",
    instructions = "Arlesh's task-management and knowledge-base data, limited to the MCP roots the user has opened to you (listed at the end). Read-only apart from arlesh_beads, which links an Agentic task to a bd issue. Start with arlesh_snapshot.load: the whole planning graph — tasks, goals, flows, domains, dependencies and derived lifecycles. It is PAGED: a response carries what fits plus next_cursor, and you must keep calling with that cursor until it is null or you will only have seen part of the board. A section missing from a page is one you have not reached yet; an empty section arrives as []. Narrow with `sections` when you know what you need. Tasks and goals carry their windows as boundary scope IDs, not dates: resolve them with arlesh_scopes.resolve_many. The other tools cover what the snapshot omits."
)]
impl ServerHandler for ArleshMcp {
    /// The handshake, with the MCP roots added to the instructions — see
    /// [`ArleshMcp::instructions`].
    async fn initialize(
        &self,
        request: InitializeRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, ErrorData> {
        context.peer.set_peer_info(request.clone());
        let mut result = self.negotiate_initialize(&request)?;
        result.instructions = Some(self.instructions().await);
        Ok(result)
    }
}

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
fn router(factory: SessionFactory, announce: Announce) -> axum::Router {
    // `allowed_hosts` already defaults to loopback only. `allowed_origins` defaults to empty,
    // which *disables* Origin validation rather than enforcing it — so a page in the user's
    // browser could POST here. `enforce_origin_validation` rejects any request that carries an
    // Origin at all, which a browser always does and an MCP client never does.
    let config = StreamableHttpServerConfig::default().enforce_origin_validation();

    let service = StreamableHttpService::new(
        move || Ok(ArleshMcp::new(factory.clone()).announcing(announce.clone())),
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
pub async fn serve(factory: SessionFactory, announce: Announce) {
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

    if let Err(error) = axum::serve(listener, router(factory, announce)).await {
        tracing::error!(error = %error, "MCP endpoint stopped");
    }
}
