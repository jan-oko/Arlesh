//! [`SqliteBackend`]: the [`Backend`](super::Backend) port served in-process, by the core over the
//! local SQLite file — the app as it has always run (Standalone mode).
//!
//! Each method is what its command did before the port existed, moved here unchanged: it opens a
//! session from the [`SessionFactory`], calls the domain, and commits.

use crate::{capacity::AgentCapacity, database::session::SessionFactory, undo::stacks::UndoStacks};

mod access;
mod block_reasons;
mod capacity;
mod commitments;
mod domains;
mod expectations;
mod flows;
mod gestures;
mod infos;
mod knowledge_base;
mod mindmap;
mod tasks;
mod undo;

/// The in-process backend over the local database.
pub struct SqliteBackend {
    /// The sole owner of the pool: every operation reaches the database through a session it
    /// hands out.
    factory: SessionFactory,
    /// The Undo and Redo Stacks, session-scoped: in memory, empty at every start.
    stacks: UndoStacks,
    /// The agent capacity lock, shared with the MCP endpoint.
    capacity: AgentCapacity,
}

impl SqliteBackend {
    /// A backend over `factory`, with its stacks and the capacity lock it shares with the MCP.
    pub fn new(factory: SessionFactory, stacks: UndoStacks, capacity: AgentCapacity) -> Self {
        Self {
            factory,
            stacks,
            capacity,
        }
    }
}
