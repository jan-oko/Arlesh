#![deny(clippy::all)]
#![deny(missing_docs)]
//! The **Backend port**: everything the Tauri commands ask of the board, behind one seam, with the two
//! backends that serve it. It is shared by the desktop app and the Python bindings, and depends on
//! `arlesh-core`, never on Tauri: a host supplies the callbacks that tell its windows or its callers
//! of a change.
//!
//! Cargo features: `sqlite` builds [`SqliteBackend`](sqlite::SqliteBackend), `http` builds
//! [`HttpBackend`](http::HttpBackend) and the change stream. The port itself is always built.
//!
//!
//! A command is a thin adapter from `invoke` to a call on the backend the app manages (`AppBackend`, in the app). What
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

pub mod access;
pub mod block_reasons;
pub mod capacity;
pub mod commitments;
pub mod domains;
pub mod expectations;
pub mod flows;
pub mod gestures;
#[cfg(feature = "http")]
pub mod http;
pub mod infos;
pub mod knowledge_base;
pub mod mindmap;
pub mod node_gestures;
pub mod revision;
#[cfg(feature = "sqlite")]
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
    + node_gestures::NodeGesturesPort
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
        + node_gestures::NodeGesturesPort
        + tasks::TasksPort
        + undo::UndoPort
{
}

#[cfg(test)]
mod tests;
