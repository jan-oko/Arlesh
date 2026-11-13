//! [`SqliteBackend`]: the [`Backend`](super::Backend) port served in-process, by the core over the
//! local SQLite file — the app as it has always run (Standalone mode).
//!
//! Each method is what its command did before the port existed, moved here unchanged: it opens a
//! session from the [`SessionFactory`], calls the domain, and commits.

use arlesh_core::{database::session::SessionFactory, undo::stacks::UndoStacks};

mod access;
mod agents;
mod block_reasons;
mod commitments;
mod domains;
mod expectations;
mod flows;
mod gestures;
mod infos;
mod knowledge_base;
mod mindmap;
mod node_gestures;
mod tasks;
mod undo;

/// The in-process backend over the local database.
pub struct SqliteBackend {
    /// The sole owner of the pool: every operation reaches the database through a session it
    /// hands out.
    factory: SessionFactory,
    /// The Undo and Redo Stacks, session-scoped: in memory, empty at every start.
    stacks: UndoStacks,
}

impl SqliteBackend {
    /// A backend over `factory`, with its stacks.
    pub fn new(factory: SessionFactory, stacks: UndoStacks) -> Self {
        Self { factory, stacks }
    }
}
