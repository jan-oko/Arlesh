//! The **Backend port**: everything the Tauri commands ask of the board, behind one seam.
//!
//! A command is a thin adapter from `invoke` to a call on the [`AppBackend`] the app manages. What
//! answers the call depends on the mode the app runs in (see `docs/spec/client-mode.md`):
//! [`SqliteBackend`](sqlite::SqliteBackend) is the in-process core over the local database file,
//! as the app has always been (Standalone mode), and [`HttpBackend`](http::HttpBackend) calls
//! `arlesh-server` over HTTP (Client mode). The port is split by domain, one trait per command module, and
//! [`Backend`] is all of them together — so an implementation that misses one operation does not
//! compile.
//!
//! What stays out of the port is the shell: windows, tabs, the tray, close-to-tray, the local MCP
//! endpoint, and the pure scope computations, which need no board at all. Announcing a change to
//! the other windows is the shell's too: a backend says *what* changed, and a command tells the
//! windows.

use std::{ops::Deref, sync::Arc};

pub mod access;
pub mod block_reasons;
pub mod capacity;
pub mod commitments;
pub mod domains;
pub mod expectations;
pub mod flows;
pub mod gestures;
pub mod http;
pub mod infos;
pub mod knowledge_base;
pub mod mindmap;
#[cfg(feature = "standalone")]
pub mod sqlite;
pub mod tasks;
pub mod undo;

/// Every operation a backend serves: the union of the per-domain ports.
pub trait Backend:
    access::AccessPort
    + block_reasons::BlockReasonsPort
    + capacity::CapacityPort
    + commitments::CommitmentsPort
    + domains::DomainsPort
    + expectations::WaitsPort
    + flows::FlowsPort
    + gestures::GesturesPort
    + infos::InfosPort
    + knowledge_base::KnowledgeBasePort
    + mindmap::BoardPort
    + tasks::TasksPort
    + undo::UndoPort
{
}

impl<T> Backend for T where
    T: access::AccessPort
        + block_reasons::BlockReasonsPort
        + capacity::CapacityPort
        + commitments::CommitmentsPort
        + domains::DomainsPort
        + expectations::WaitsPort
        + flows::FlowsPort
        + gestures::GesturesPort
        + infos::InfosPort
        + knowledge_base::KnowledgeBasePort
        + mindmap::BoardPort
        + tasks::TasksPort
        + undo::UndoPort
{
}

/// The backend the app runs on, as Tauri manages it: every command resolves
/// `State<AppBackend>` and calls through it.
#[derive(Clone)]
pub struct AppBackend(Arc<dyn Backend>);

impl AppBackend {
    /// Wraps `backend` for Tauri to manage.
    pub fn new(backend: impl Backend + 'static) -> Self {
        Self(Arc::new(backend))
    }

    /// Wraps a backend the app also holds elsewhere: Client mode's, which the change stream and
    /// the status commands reach too.
    pub fn shared(backend: Arc<dyn Backend>) -> Self {
        Self(backend)
    }
}

impl Deref for AppBackend {
    type Target = dyn Backend;

    fn deref(&self) -> &Self::Target {
        self.0.as_ref()
    }
}

#[cfg(test)]
mod tests;
