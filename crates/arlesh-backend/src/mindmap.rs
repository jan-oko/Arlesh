//! The `mindmap` part of the [`Backend`](super::Backend) port: what the commands in
//! the app's `mindmap` commands ask of whichever backend the app runs on.

use crate::revision::BoardLoad;
use arlesh_core::error::WireError;

/// The `mindmap` operations a backend serves.
#[async_trait::async_trait]
pub trait BoardPort: Send + Sync {
    /// Every payload one mindmap render needs, in a single round trip, with the revision it was
    /// read at when the backend has one (Client mode).
    async fn load_mindmap(&self, now: chrono::NaiveDateTime) -> Result<BoardLoad, WireError>;
}
