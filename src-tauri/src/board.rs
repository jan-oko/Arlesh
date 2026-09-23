//! The board-changed broadcast: how one window tells the others that the board moved.
//!
//! Every mutation used to end in a reload **in the window that issued it**, which was the whole
//! story while there was one window. With a tab torn off into a second one, two views onto one
//! database would quietly disagree — and two views that disagree are worse than one view.
//!
//! So a change announces itself. The announcement is a Tauri event named [`BOARD_CHANGED`],
//! carrying **no payload**: it is a signal to reload, not a diff. That is deliberate. A payload
//! would have to describe what changed, which is a second description of the mutation living
//! beside the mutation itself, free to drift from it; a bare signal cannot be wrong about anything.
//! It is also cheap to act on, because the Mindmap loads in a single request.
//!
//! # Where it is emitted, and why not per command
//!
//! The obvious reading of "every mutating command emits after it commits" is a line at the end of
//! all 83 of them. That is the same obligation ADR 0006 refused for undo, for the same reason: an
//! obligation met 83 times and again by every command written afterwards is one that will
//! eventually be forgotten, silently, by the command least likely to be tested for it.
//!
//! The announcement is therefore derived from the journal those commands already write. A Gesture
//! closes, the backend asks the journal whether it wrote anything, and announces when it did —
//! after the commit, because the journal rows only exist once the transaction that wrote them has
//! landed. A command cannot forget, because a command that wrote nothing to the journal wrote
//! nothing to the board; and `tests/undo_journal.rs` already fails for any table whose writes are
//! not journaled, so the obligation that remains is one the test suite already guards.
//!
//! Two writes are invisible to the journal by design and announce themselves directly instead:
//! **undo and redo**, which suppress journalling for the length of their own transaction (see
//! [`crate::undo`]), and an **MCP write**, which does not go through the Gesture protocol at all.
//!
//! # Who hears it
//!
//! Every window but the one that made the change. The window that issued the command already
//! reloads on the way back from it — that is the path this design reuses rather than replacing —
//! so sending it the event too would buy a second identical read of the board for every edit.
//! [`recipients`] is that rule, and it is all of the decision; the emitting lives in
//! [`crate::commands::board`], which is Tauri's side of it.

use std::sync::Arc;

#[cfg(test)]
mod tests;

/// The Tauri event name every window listens for. No payload: see this module's header.
pub const BOARD_CHANGED: &str = "board-changed";

/// Announces a committed change to every window but the one that made it, if any.
///
/// A function rather than a trait so that a caller outside Tauri — the MCP endpoint, which knows
/// nothing about windows — can be handed one without taking on an `AppHandle`.
pub type Announce = Arc<dyn Fn(Option<&str>) + Send + Sync>;

/// An [`Announce`] that tells nobody, for a host with no windows to tell.
pub fn silent() -> Announce {
    Arc::new(|_| {})
}

/// Which of the open windows a board change has to reach: all of them but `origin`.
///
/// `origin` is the label of the window whose command made the change, and `None` means the change
/// came from somewhere that is not a window at all — an agent through the MCP endpoint — in which
/// case every window needs telling.
pub fn recipients<'a>(open: &'a [String], origin: Option<&str>) -> Vec<&'a str> {
    open.iter()
        .map(String::as_str)
        .filter(|label| Some(*label) != origin)
        .collect()
}
