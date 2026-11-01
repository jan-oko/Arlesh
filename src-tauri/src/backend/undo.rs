//! The `undo` part of the [`Backend`](super::Backend) port: the Gesture boundary, and undo and
//! redo. Announcing a change to the other windows stays in [`crate::commands::undo`], since a
//! window is the shell's, not the backend's.

use crate::{
    error::WireError,
    undo::{
        model::{GestureId, GestureSummary, UndoStatus},
        GestureAbort, GestureClose,
    },
};

/// The Gesture and undo operations a backend serves.
#[async_trait::async_trait]
pub trait UndoPort: Send + Sync {
    /// Opens a Gesture, or joins the one already open.
    async fn open_gesture(&self) -> Result<GestureId, WireError>;

    /// Closes one open Gesture: what reached the Undo Stack, and whether the board moved.
    async fn close_gesture(&self) -> Result<GestureClose, WireError>;

    /// Closes one open Gesture and takes back what it wrote.
    async fn abort_gesture(&self) -> Result<GestureAbort, WireError>;

    /// Reverses the most recent user Gesture; `None` when the Undo Stack is empty.
    async fn undo(&self) -> Result<Option<GestureSummary>, WireError>;

    /// Reapplies the most recently undone Gesture; `None` when the Redo Stack is empty.
    async fn redo(&self) -> Result<Option<GestureSummary>, WireError>;

    /// What the next undo and the next redo would be.
    async fn undo_status(&self) -> Result<UndoStatus, WireError>;
}
