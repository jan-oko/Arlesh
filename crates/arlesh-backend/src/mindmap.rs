//! The `mindmap` part of the [`Backend`](super::Backend) port: what the commands in
//! the app's `mindmap` commands ask of whichever backend the app runs on.

use crate::revision::{BoardHead, BoardLoad, BoardRevision, CurrentBoard};
use arlesh_core::error::WireError;

/// The `mindmap` operations a backend serves.
#[async_trait::async_trait]
pub trait BoardPort: Send + Sync {
    /// Every payload one mindmap render needs, in a single round trip, with the revision it was
    /// read at when the backend has one (Client mode). Derived afresh at `now`: what scripts and
    /// agents read. A window takes the board in through [`Self::current_board`].
    async fn load_mindmap(&self, now: chrono::NaiveDateTime) -> Result<BoardLoad, WireError>;

    /// The latest published board, as it is: what a window loads first, after a gap, an epoch
    /// change or a hash mismatch. It derives nothing.
    async fn current_board(&self) -> Result<CurrentBoard, WireError>;

    /// The newest revision a write is known to have reached, which a writer settles on: the window
    /// waits until its board holds it. `None` while the backend has heard no stamp yet.
    async fn board_fence(&self) -> Option<BoardRevision>;

    /// The latest publication's identity, for a window to check its board against. `None` while
    /// the backend has heard none.
    async fn board_head(&self) -> Option<BoardHead>;
}
