//! [`SqliteBackend`]: the [`Backend`](super::Backend) port served in-process, by the core over the
//! local SQLite file — the app as it has always run (Standalone mode).
//!
//! Each method is what its command did before the port existed, moved here unchanged: it opens a
//! session from the [`SessionFactory`], calls the domain, and commits.

use std::sync::Arc;

use arlesh_core::{
    board::Announce,
    database::session::SessionFactory,
    mcp::events::ChangeFeed,
    mindmap::publisher::{BoardPublisher, LocalClock, Sink},
    undo::stacks::UndoStacks,
};

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
    /// Derives the board after every write this backend records and every minute, and tells the
    /// sink what changed (ADR 0020).
    publisher: BoardPublisher,
}

impl SqliteBackend {
    /// A backend over `factory`, with its stacks.
    ///
    /// Starts a board publisher on `runtime` over a feed of its own: `sink` is told each change
    /// event, which the shell turns into the windows' `board-changed`. The backend records a write
    /// itself where it knows one happened (a Gesture that wrote, undo and redo, the writes the
    /// journal does not see); an MCP write is recorded through [`Self::write_recorder`].
    pub fn new(
        factory: SessionFactory,
        stacks: UndoStacks,
        sink: Sink,
        runtime: &tokio::runtime::Handle,
    ) -> Self {
        let publisher = BoardPublisher::start(
            factory.clone(),
            ChangeFeed::new(),
            Arc::new(LocalClock),
            sink,
            runtime,
        );
        Self {
            factory,
            stacks,
            publisher,
        }
    }

    /// What tells the publisher a write committed, for a writer that is not a command: the MCP
    /// endpoint hands it to every write an agent makes.
    pub fn write_recorder(&self) -> Announce {
        let publisher = self.publisher.clone();
        Arc::new(move |_origin: Option<&str>| publisher.record_write())
    }
}

#[cfg(test)]
mod tests;
