//! The `mindmap` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::mindmap`] ask of whichever backend the app runs on.

use crate::{backend::revision::BoardLoad, error::WireError};

/// The `mindmap` operations a backend serves.
#[async_trait::async_trait]
pub trait BoardPort: Send + Sync {
    /// Every payload one mindmap render needs, in a single round trip, with the revision it was
    /// read at when the backend has one (Client mode).
    async fn load_mindmap(&self, now: chrono::NaiveDateTime) -> Result<BoardLoad, WireError>;
}
