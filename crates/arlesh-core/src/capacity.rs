//! The agent capacity lock: one app-wide on/off state meaning "agents are at capacity".
//!
//! An agent — or whoever runs a fleet of them — sets it over the MCP when it cannot take on more
//! Agentic work, and clears it when there is room again; the user can set and clear it from the
//! app as well. While it is on, every Agentic Task not yet Done is **derived blocked** — it acts
//! as a dependency every Agentic Task has — and everything blocked already does follows: Start
//! hides it, the app refuses to start it, the blocked glyph shows. That derivation is
//! [`blocks`], and it is the same for the app and the MCP. See `docs/spec/mcp-server.md`,
//! "Agent capacity".
//!
//! # Where it lives
//!
//! In a file in the app's data directory, [`CAPACITY_FILE`], beside the MCP port's `mcp.json` and
//! for the same reason: it is operational state about the agents working this machine's board,
//! not a fact of the board itself. A row would be journaled, and Ctrl+Z would flip the lock.
//!
//! One [`AgentCapacity`] is shared by the Tauri commands and every MCP session, and it holds the
//! value in memory behind a lock so a read never touches the disk. Every [`AgentCapacity::set`]
//! writes the file before it answers and then tells the windows through the [`Notify`] it was
//! built with — the app's is a Tauri event (see the app crate's `commands::capacity`).

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

pub use rules::blocks;
pub mod rules;

#[cfg(test)]
mod tests;

/// The file in the app's data directory that holds the lock.
pub const CAPACITY_FILE: &str = "agent-capacity.json";

/// The lock as it is read and written: stored in the file, answered by the commands and the MCP.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema,
)]
pub struct CapacityState {
    /// Whether agents are at capacity. Off when nothing was ever saved.
    #[serde(default)]
    pub at_capacity: bool,
}

/// Told the new state after every [`AgentCapacity::set`] has been saved.
///
/// A closure rather than an `AppHandle`, as [`crate::board::Announce`] is, so nothing here has to
/// know what a window is.
pub type Notify = Arc<dyn Fn(CapacityState) + Send + Sync>;

/// A lock change that could not be saved.
#[derive(Debug, thiserror::Error)]
pub enum CapacityError {
    /// The file could not be written. The lock keeps the value it had.
    #[error("could not save the agent capacity lock: {0}")]
    Save(#[from] std::io::Error),
}

/// The agent capacity lock, shared by the commands and every MCP session.
#[derive(Clone)]
pub struct AgentCapacity {
    inner: Arc<Inner>,
}

struct Inner {
    /// Where the lock is saved; `None` keeps it in memory only.
    path: Option<PathBuf>,
    notify: Notify,
    state: Mutex<CapacityState>,
}

impl AgentCapacity {
    /// The lock saved at `path` — off when there is no file yet — telling `notify` of each change.
    pub fn open(path: PathBuf, notify: Notify) -> Self {
        let state = read_state(&path);
        Self::build(Some(path), notify, state)
    }

    /// A lock that is never saved and tells nobody, starting off. For a host with no data
    /// directory and no windows — every MCP handler a test builds.
    pub fn in_memory() -> Self {
        Self::build(None, Arc::new(|_| {}), CapacityState::default())
    }

    fn build(path: Option<PathBuf>, notify: Notify, state: CapacityState) -> Self {
        Self {
            inner: Arc::new(Inner {
                path,
                notify,
                state: Mutex::new(state),
            }),
        }
    }

    /// The lock as it stands.
    pub async fn get(&self) -> CapacityState {
        *self.inner.state.lock().await
    }

    /// Sets the lock on or off, saves it, and tells the windows. Setting the value it already has
    /// is not an error, and still tells them — a window that had drifted catches up.
    #[tracing::instrument(skip(self))]
    pub async fn set(&self, at_capacity: bool) -> Result<CapacityState, CapacityError> {
        let mut state = self.inner.state.lock().await;
        let next = CapacityState { at_capacity };
        if let Some(path) = &self.inner.path {
            write_state(path, next)?;
        }
        *state = next;
        tracing::info!(at_capacity, "agent capacity lock set");
        (self.inner.notify)(next);
        Ok(next)
    }
}

/// The lock saved at `path`: off when there is no file, and off — with a warning — when the file
/// cannot be read, since a lock nobody can read must not hide work.
fn read_state(path: &Path) -> CapacityState {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return CapacityState::default()
        }
        Err(error) => {
            tracing::warn!(error = %error, path = %path.display(), "could not read the agent capacity lock");
            return CapacityState::default();
        }
    };
    serde_json::from_str(&text).unwrap_or_else(|error| {
        tracing::warn!(error = %error, path = %path.display(), "ignoring an unreadable agent capacity lock");
        CapacityState::default()
    })
}

/// Saves `state` at `path`.
fn write_state(path: &Path, state: CapacityState) -> Result<(), std::io::Error> {
    let text = serde_json::to_string_pretty(&state).map_err(std::io::Error::other)?;
    std::fs::write(path, text)
}
