//! The Undo and Redo Stacks: what the user did, and what undo took back.
//!
//! **One pair for the whole application**, held in backend memory beside the session factory —
//! not in the frontend, which has several views onto one board and would give each of them a
//! private history, and not in the database, which would outlive the session the stacks are scoped
//! to. A per-view stack could undo past another view's newer edit; there is one board and one
//! history of changes to it.
//!
//! # What goes on a stack, and what does not
//!
//! A Gesture reaches the Undo Stack when it closes, carrying **only its `user` entries** — the
//! journal is a faithful history of every write, and the stack is a history of *the user*. An
//! agent's MCP write between the user's change and their Ctrl+Z is therefore not on the stack, is
//! not reversed, and does not clear the Redo Stack: it never enters either one.
//!
//! A Gesture that produced no user entries never reaches a stack at all, so a press is never spent
//! on a step with no effect.
//!
//! # Why a new Gesture clears the Redo Stack
//!
//! Redo reapplies rows by rowid over a board that has moved on since they were recorded, and what
//! it would reapply them *onto* is no longer the state they were taken from. [`UndoStacks::record`]
//! therefore empties the Redo Stack whenever a user Gesture lands. This is the ordinary rule for
//! an undo stack, and here it is also a safety one.

use std::sync::Mutex;

use super::model::{StackedGesture, UndoStatus};
use super::statement::Replay;
use super::MAX_JOURNALLED_GESTURES;

/// One of the two stacks.
///
/// Undo and redo are the same operation over opposite stacks in opposite directions, so the
/// difference between them is this value and nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stack {
    /// Gestures the user made, newest on top. Ctrl+Z takes from here.
    Undo,
    /// Gestures undo took back, newest on top. Ctrl+Shift+Z takes from here.
    Redo,
}

impl Stack {
    /// The direction a Gesture taken from this stack is replayed in.
    pub(super) fn direction(self) -> Replay {
        match self {
            Self::Undo => Replay::Inverse,
            Self::Redo => Replay::Forward,
        }
    }

    /// The stack a Gesture taken from this one lands on once it has been applied.
    pub(super) fn opposite(self) -> Self {
        match self {
            Self::Undo => Self::Redo,
            Self::Redo => Self::Undo,
        }
    }
}

/// Both stacks, shared by every caller.
///
/// Managed by Tauri beside the [`SessionFactory`](crate::database::session::SessionFactory) and
/// reached by the `undo`, `redo`, `undo_status` and `close_gesture` commands. Cleared on restart
/// by being newly constructed, which is all "session-scoped" has to mean.
#[derive(Debug, Default)]
pub struct UndoStacks {
    /// The two stacks, behind one lock so that a Gesture cannot be on both or on neither.
    ///
    /// A plain [`std::sync::Mutex`] rather than an async one, deliberately: its guard is not
    /// `Send`, so the compiler refuses a future that holds it across an `await`. Applying a
    /// Gesture takes many `await`s, and a lock held across them would serialise the database
    /// behind a data structure that only ever needs it for a push and a pop.
    stacks: Mutex<Stacks>,
}

/// The stacks themselves, only ever reached under the lock.
#[derive(Debug, Default)]
struct Stacks {
    /// Gestures the user made and has not undone, oldest first.
    undoable: Vec<StackedGesture>,
    /// Gestures undo took back and redo has not put back, oldest first.
    redoable: Vec<StackedGesture>,
}

impl UndoStacks {
    /// Two empty stacks.
    pub fn new() -> Self {
        Self::default()
    }

    /// Puts a closed user Gesture on the Undo Stack, and empties the Redo Stack.
    ///
    /// Capped at [`MAX_JOURNALLED_GESTURES`], matching the journal's own bound: the oldest Gesture
    /// is dropped rather than the newest refused, because the step the user is most likely to want
    /// back is the one they just made.
    pub fn record(&self, gesture: StackedGesture) {
        let mut stacks = self.locked();
        stacks.redoable.clear();
        stacks.undoable.push(gesture);
        if stacks.undoable.len() > MAX_JOURNALLED_GESTURES {
            let excess = stacks.undoable.len() - MAX_JOURNALLED_GESTURES;
            stacks.undoable.drain(..excess);
        }
    }

    /// Whether there is anything to undo or redo, and what each one is.
    pub fn status(&self) -> UndoStatus {
        let stacks = self.locked();
        UndoStatus {
            undo: stacks.undoable.last().map(StackedGesture::summary),
            redo: stacks.redoable.last().map(StackedGesture::summary),
        }
    }

    /// The Gesture on top of `stack`, removed from it, or `None` when it is empty.
    pub(super) fn take(&self, stack: Stack) -> Option<StackedGesture> {
        self.select(&mut self.locked(), stack).pop()
    }

    /// Puts `gesture` on top of `stack`.
    ///
    /// Used both to move an applied Gesture across to the other stack and to put an unapplied one
    /// back where it came from: a replay that failed changed nothing, so the stacks must end where
    /// they started too.
    pub(super) fn put(&self, stack: Stack, gesture: StackedGesture) {
        self.select(&mut self.locked(), stack).push(gesture);
    }

    /// One of the two stacks, under a held lock.
    fn select<'guard>(
        &self,
        stacks: &'guard mut Stacks,
        stack: Stack,
    ) -> &'guard mut Vec<StackedGesture> {
        match stack {
            Stack::Undo => &mut stacks.undoable,
            Stack::Redo => &mut stacks.redoable,
        }
    }

    /// The stacks, recovering from a poisoned lock rather than propagating the panic.
    ///
    /// Every mutation under this lock is a push, a pop or a `clear` on a `Vec`, none of which can
    /// leave the stacks half-written, so a panic elsewhere in the process is no reason to refuse
    /// the user their undo history for the rest of the session. This is also why `.unwrap()` is
    /// not what stands here.
    fn locked(&self) -> std::sync::MutexGuard<'_, Stacks> {
        self.stacks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests;
