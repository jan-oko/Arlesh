//! A request context with no connection behind it.
//!
//! `rmcp` hands a tool the [`RequestContext`] of the connection it was called over, and builds one
//! only inside a running service: its [`Peer`](rmcp::service::Peer) cannot be made outside one.
//! None of Arlesh's tools reads it — they take their parameters and nothing else — but the router
//! that dispatches them wants one. A host that speaks the protocol itself, without an `rmcp`
//! transport (the Python server, answering JSON-RPC from FastAPI), still dispatches through that
//! router, so a tool's result, an unknown tool and bad parameters are answered by the very code
//! the connected endpoint runs.
//!
//! So it starts one idle service on an in-memory pipe whose far end nothing ever reads, skipping
//! the handshake, and lends out its context. A tool that one day sent the client a notification
//! would send it nowhere; none does.

use rmcp::{
    model::NumberOrString,
    service::{serve_directly, RequestContext, RunningService},
    RoleServer, ServerHandler,
};
use tokio::io::{duplex, DuplexStream};

/// The idle service: it answers nothing, since nothing is connected to ask it.
struct Idle;

impl ServerHandler for Idle {}

/// The idle service and the far end of its pipe, kept so it stays up for as long as this is held.
pub(super) struct Detached {
    _service: RunningService<RoleServer, Idle>,
    _far_end: DuplexStream,
    context: RequestContext<RoleServer>,
}

impl Detached {
    /// Starts the idle service. Needs a Tokio runtime, which spawns the service's loop.
    pub(super) fn start() -> Self {
        let (near_end, far_end) = duplex(1024);
        let service = serve_directly(Idle, near_end, None);
        let context = RequestContext::new(NumberOrString::Number(0), service.peer().clone());
        Self {
            _service: service,
            _far_end: far_end,
            context,
        }
    }

    /// A context for one call.
    pub(super) fn context(&self) -> RequestContext<RoleServer> {
        self.context.clone()
    }
}
