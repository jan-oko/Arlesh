//! What every open of one database file in this process shares: the change feed and the MCP
//! sessions.
//!
//! The server opens the same file several times — a read-only open for the reads, and one
//! write-open per client — and each client's write-open serves that client's MCP endpoint. They
//! must all see one capacity lock, or a lock set through one route would not block the agents of
//! another client's endpoint until a restart. And they must all count into one **revision**, the
//! number `GET /events/changes` streams: a write through any open, or an agent's write through any
//! endpoint, is a change every device has to hear about.
//!
//! So both live here, one pair per database file, for as long as the process runs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use arlesh_core::mcp::{
    events::{ChangeFeed, EventStreams, WaitLogs},
    session::Sessions,
};
use arlesh_core::mindmap::publisher::BoardPublisher;

/// The board's revision: bumped once for every committed write, from any open of the file.
pub(crate) type Changes = ChangeFeed;

/// The change feed, wait logs and MCP sessions of one database file.
pub(crate) struct Shared {
    /// Held across every write's Gesture — open, write, close — so two clients' writes never
    /// share the one ambient Gesture the journal stamps from. See [`crate::request::run`].
    pub(crate) writes: tokio::sync::Mutex<()>,
    /// The board's revision.
    pub(crate) changes: Changes,
    /// What the long poll of `/events/expectations` answers from, beside the revision.
    pub(crate) logs: WaitLogs,
    /// The MCP sessions of this file, by the id `/mcp` issued: each is bound to an Agent once it
    /// attaches. In memory only, so a restart forgets them and the clients attach again.
    pub(crate) sessions: Sessions,
    /// Derives and publishes the board's changes: started once per file by
    /// [`crate::NativeDatabase::start_publisher`], on the first open that asks.
    pub(crate) publisher: OnceLock<BoardPublisher>,
}

impl Shared {
    /// The streams over this file: its change feed and wait logs. This host hears of every write,
    /// so the waits are not polled.
    pub(crate) fn streams(&self) -> EventStreams {
        EventStreams {
            feed: self.changes.clone(),
            poll: None,
            logs: self.logs.clone(),
        }
    }
}

/// The [`Shared`] state of the database at `path`, made on first use.
pub(crate) fn for_database(path: &Path) -> Arc<Shared> {
    static REGISTRY: OnceLock<Mutex<HashMap<PathBuf, Arc<Shared>>>> = OnceLock::new();
    let key = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let registry = REGISTRY.get_or_init(Mutex::default);
    // A poisoned registry only means another thread panicked while inserting; the map is intact.
    let mut entries = registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(entries.entry(key).or_insert_with(|| {
        let changes = Changes::new();
        Arc::new(Shared {
            writes: tokio::sync::Mutex::new(()),
            changes,
            logs: WaitLogs::default(),
            sessions: Sessions::default(),
            publisher: OnceLock::new(),
        })
    }))
}
