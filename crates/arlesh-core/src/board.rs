//! The board's changes, and how a write is told to the publisher: the contract behind the windows'
//! live board (ADR 0020).
//!
//! A write used to end in a whole-board reload in the window that wrote, and a payload-less signal
//! told the others to reload too. Now a committed write is *recorded*, the
//! [publisher](crate::mindmap::publisher) derives the board and compares it with the one before,
//! and every window (the writer included) is sent **the changed nodes**, which it applies to the
//! board it holds. The event is not a second description of the write written beside it: it is the
//! difference of two boards derived by the same function, so it cannot drift from the writes.
//!
//! # Where a write is recorded, and why not per command
//!
//! The obvious reading of "every mutating command records itself after it commits" is a line at
//! the end of all 83 of them. That is the same obligation ADR 0006 refused for undo, for the same
//! reason: an obligation met 83 times and again by every command written afterwards is one that
//! will eventually be forgotten, silently, by the command least likely to be tested for it.
//!
//! A write is therefore derived from the journal those commands already write. A Gesture closes,
//! the backend asks the journal whether it wrote anything, and records a write when it did, after
//! the commit, because the journal rows only exist once the transaction that wrote them has
//! landed. A command cannot forget, because a command that wrote nothing to the journal wrote
//! nothing to the board; and `tests/undo_journal.rs` already fails for any table whose writes are
//! not journaled.
//!
//! The writes the journal does not see record themselves: **undo and redo**, which suppress
//! journalling for the length of their own transaction (see [`crate::undo`]), an **MCP write**,
//! which does not go through the Gesture protocol at all (it is handed an [`Announce`] that
//! records), and the few the board reads without the journal's seeing them (the MCP roots and the
//! agents' Claims and locks). One the backend misses is caught by the publisher's minute tick,
//! which derives the board again: it is at most a minute behind.
//!
//! # Who hears it
//!
//! Every window, the one that made the change included. The writer no longer reloads after its
//! write; it waits to hold the write's revision (`settle`, in the frontend), and the event is how
//! it gets there. A window that missed an event finds the gap at the next one, or at its next look
//! at the publisher's head, and loads the board whole.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// Who made a committed write: what a host says when it records one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOrigin {
    /// One of the user's devices: the desktop app or the phone, undo and redo included.
    User,
    /// An agent, through the MCP.
    Agent,
}

/// Who caused a publication's changes (`docs/spec/notifications.md`, *Own actions*).
///
/// Carried in every change event so that whoever turns a change into a notification can leave the
/// user's own actions out: nobody is told what the user did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeOrigin {
    /// Only the user's writes landed since the publication before.
    User,
    /// An agent's write landed since the publication before (with or without the user's).
    Agent,
    /// No write landed: time passed (a scope ended, a due date came).
    Time,
}

impl ChangeOrigin {
    /// The origin of a publication that holds writes up to `reached`, after one that held writes
    /// up to `previous`, given the revisions at which agents wrote. An agent's write among the new
    /// ones makes it the agent's: the user's own action is never taken for it, and the other way
    /// round is only ever a notification too many.
    pub fn between(previous: u64, reached: u64, agent_writes: &[u64]) -> Self {
        if reached <= previous {
            return Self::Time;
        }
        let agent = agent_writes
            .iter()
            .any(|revision| *revision > previous && *revision <= reached);
        if agent {
            Self::Agent
        } else {
            Self::User
        }
    }

    /// Whether what this origin changed may be told to the user: not when it is the user's own.
    pub fn notifies(self) -> bool {
        self != Self::User
    }
}

#[cfg(test)]
mod tests;

/// The Tauri event name every window listens for. Its payload is the change event: the changed
/// nodes, with the revision and the epoch (ADR 0020, decision 16).
pub const BOARD_CHANGED: &str = "board-changed";

/// Records a committed write, for a writer that is not a command: the MCP endpoint is handed one.
///
/// A function rather than a trait so that a caller outside Tauri, the MCP endpoint, which knows
/// nothing about windows, can be handed one without taking on an `AppHandle`. The argument is the
/// label of the window that made the write, when there is one; nothing reads it now that every
/// window hears every change.
pub type Announce = Arc<dyn Fn(Option<&str>) + Send + Sync>;

/// An [`Announce`] that tells nobody, for a host with no windows to tell.
pub fn silent() -> Announce {
    Arc::new(|_| {})
}
