//! MCP server exposing Arlesh's reads to an agent.
//!
//! A second adapter over the session layer, sibling to [`commands`](crate::commands): both open a
//! session from the same [`SessionFactory`] and delegate to the same stateless resource operators,
//! and neither depends on the other. The Tauri commands serve the app's own frontend; these tools
//! serve an MCP client — Claude Code, Claude Desktop — over localhost HTTP.
//!
//! # Shape of the surface
//!
//! Eight tools rather than one per command. [`ArleshMcp::snapshot`] returns the whole planning
//! graph in one payload, so the read tools beside it exist only for what it does not carry: scope
//! resolution, the knowledge base, and the handful of per-item and what-if reads. An MCP client
//! pays context for every tool definition it loads, which is why the surface is grouped rather
//! than mirrored.
//!
//! # Reads and writes
//!
//! Four tools write something the user sees. [`ArleshMcp::tasks`] creates, edits, moves,
//! re-statuses and archives Tasks — creating anywhere inside the roots, never under a Task marked
//! Not agentic, and changing only Tasks that read as Agentic. [`ArleshMcp::beads`] sets the `bd`
//! issue id on an Agentic Task, the only way that field can be set at all, and
//! [`ArleshMcp::waits`] raises an agentic wait under one — "the agent is waiting on you" — and
//! [`ArleshMcp::infos`] hangs a note (an Info) under one. Every
//! other tool, [`ArleshMcp::snapshot`] included, is annotated `read_only_hint = true` and writes
//! nothing. Every write is journaled under the `mcp` source, so none enters the user's Undo Stack.
//!
//! # Ids
//!
//! Every tool that names a node takes its row id or its **short id** — see [`ids`] — and the
//! snapshot sends each node's `short_id` beside its `id`.
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
mod agentic;
mod beads;
pub mod endpoint;
mod flows;
mod ids;
mod infos;
mod kb;
mod lookup;
pub mod paging;
pub mod params;
mod result;
mod schema;
mod scopes;
mod snapshot;
mod tasks;
mod waits;

use std::sync::Arc;

use chrono::NaiveDateTime;

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
    /// What time it is, for the writes and the short-id reads that derive the board. The wall
    /// clock, unless a test fixes it with [`ArleshMcp::with_clock`].
    clock: Clock,
    tool_router: ToolRouter<Self>,
}

/// A source of the current local time.
type Clock = Arc<dyn Fn() -> NaiveDateTime + Send + Sync>;

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
            clock: Arc::new(|| chrono::Local::now().naive_local()),
            tool_router: Self::flattened(
                Self::snapshot_router()
                    + Self::scopes_router()
                    + Self::kb_router()
                    + Self::tasks_router()
                    + Self::flows_router()
                    + Self::beads_router()
                    + Self::waits_router()
                    + Self::infos_router(),
            ),
        }
    }

    /// `router` with every tool's input schema flattened to one object — see [`schema`].
    fn flattened(mut router: ToolRouter<Self>) -> ToolRouter<Self> {
        for route in router.map.values_mut() {
            schema::flatten_tool(&mut route.attr);
        }
        router
    }

    /// Every registered tool as `tools/list` serves it: name, description and input schema.
    pub fn tools(&self) -> Vec<rmcp::model::Tool> {
        self.tool_router.list_all()
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

    /// Fixes the time this handler's writes and short-id reads derive the board at.
    ///
    /// For tests: a Habit's occurrences are derived up to "now", so a test naming one needs the
    /// board derived at the instant its fixture assumes.
    pub fn with_clock(mut self, clock: impl Fn() -> NaiveDateTime + Send + Sync + 'static) -> Self {
        self.clock = Arc::new(clock);
        self
    }

    /// The current time, by this handler's clock.
    fn now(&self) -> NaiveDateTime {
        (self.clock)()
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
    name = "Arlesh",
    instructions = "Arlesh's task-management and knowledge-base data, limited to the MCP roots the user has opened to you (listed at the end). You may create tasks (arlesh_tasks.create — anywhere inside the roots except under a task marked Not agentic; what you create is always Agentic) and edit, re-status and move Agentic tasks (arlesh_tasks.update/set_status/move) and archive Agentic Habit occurrences (arlesh_tasks.archive; a stored task cannot be archived yet); set_status is a compare-and-set naming the status you last saw. arlesh_beads links an Agentic task to a bd issue, and arlesh_waits raises a wait under an Agentic task — a question when you need the user (\"the agent is waiting on you\"), or with question: false when you wait on something else, like CI — releases it (a question only with the answer, e.g. one you got by asking the user yourself) and polls it with get. arlesh_infos.create hangs a note (an Info: a one-line body and optional details) under an Agentic task — e.g. to keep a long title's full wording when you shorten the title. Everything else is read-only. Every node comes back with id, short_id and full_id; name one by any of them, as a string — its row id, or a prefix (3+ characters) of its full id such as the short_id; an id matching several nodes is refused as ambiguous_id, listing them. When writing, a parameter left out means unchanged and null means clear. An Agentic task carries an agentic_brief (priority \"MW\", \"A\", \"B\" or \"C\", most urgent first, or null; spec, design, acceptance, notes): read it before working the task; a task with no spec cannot be started. Start with arlesh_snapshot.load — `now` is optional and defaults to the current time; add `agentic: {}` (or `{\"max_priority\": \"A\"}`) for just the Agentic tasks: the whole planning graph — tasks, goals, flows, domains, dependencies and derived lifecycles. It is PAGED: a response carries what fits plus next_cursor, and you must keep calling with that cursor until it is null or you will only have seen part of the board. A section missing from a page is one you have not reached yet; an empty section arrives as []. Narrow with `sections` when you know what you need. Tasks and goals carry their windows as boundary scope IDs, not dates: resolve them with arlesh_scopes.resolve_many. The other tools cover what the snapshot omits; each tool's description lists its operations and the parameters each takes. Details: a node's origin says whether it is a Habit occurrence (id a UUID), a commitment's verdict is recorded, never inferred, and a parent under a domain-table row is named project (a Project) or domain (any other subtype)."
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

/// The port the endpoint binds to when no setting is saved: [`PORT_ENV_VAR`] when set and
/// parseable, else [`DEFAULT_PORT`]. The running app also honours the user's saved port — see
/// [`endpoint::McpEndpoint`].
pub fn port() -> u16 {
    endpoint::env_port().unwrap_or(DEFAULT_PORT)
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
