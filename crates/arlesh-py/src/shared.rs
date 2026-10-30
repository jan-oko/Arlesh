//! What every open of one database file in this process shares: the agent capacity lock and the
//! change feed.
//!
//! The server opens the same file several times — a read-only open for the reads, and one
//! write-open per client — and each client's write-open serves that client's MCP endpoint. They
//! must all see one capacity lock, or a lock set through one route would not block the agents of
//! another client's endpoint until a restart. And they must all count into one **revision**, the
//! number `GET /events` streams: a write through any open, or an agent's write through any
//! endpoint, is a change every device has to hear about.
//!
//! So both live here, one pair per database file, for as long as the process runs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use arlesh_core::{board::Announce, capacity::AgentCapacity};
use tokio::sync::watch;

/// The board's revision: bumped once for every committed write, from any open of the file.
#[derive(Clone)]
pub(crate) struct Changes {
    revision: watch::Sender<u64>,
}

impl Changes {
    fn new() -> Self {
        Self {
            revision: watch::Sender::new(0),
        }
    }

    /// Records one committed write.
    pub(crate) fn bump(&self) {
        self.revision.send_modify(|revision| *revision += 1);
    }

    /// The revision as it stands.
    pub(crate) fn revision(&self) -> u64 {
        *self.revision.borrow()
    }

    /// Waits until the revision is past `after`, and answers it.
    pub(crate) async fn after(&self, after: u64) -> u64 {
        let mut receiver = self.revision.subscribe();
        // `wait_for` fails only when the sender is gone, and this `Changes` holds it.
        match receiver.wait_for(|revision| *revision > after).await {
            Ok(revision) => *revision,
            Err(_) => self.revision(),
        }
    }

    /// An [`Announce`] that counts an agent's write as a change.
    pub(crate) fn announcer(&self) -> Announce {
        let changes = self.clone();
        Arc::new(move |_origin: Option<&str>| changes.bump())
    }
}

/// The capacity lock and the change feed of one database file.
pub(crate) struct Shared {
    /// The agent capacity lock, kept beside the database as the app keeps it.
    pub(crate) capacity: AgentCapacity,
    /// The board's revision.
    pub(crate) changes: Changes,
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
        let notified = changes.clone();
        let capacity = AgentCapacity::open(
            crate::mcp::capacity_file(path),
            // The lock is part of the board as drawn, so a change to it is a change to the board.
            Arc::new(move |_state| notified.bump()),
        );
        Arc::new(Shared { capacity, changes })
    }))
}
