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
