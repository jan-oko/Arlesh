//! The change feed: a counter of the board's committed writes, and the run of the host it counts in.

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use tokio::sync::watch;

use crate::board::{Announce, ChangeOrigin, WriteOrigin};

/// How many of the agents' latest writes the feed remembers the revision of.
pub(super) const AGENT_WRITES_KEPT: usize = 1024;

/// The board's **revision**: bumped once for every committed write the host hears of, with the
/// **epoch** that names this run of the host (the revision starts again at 0 when it restarts).
#[derive(Clone)]
pub struct ChangeFeed {
    revision: watch::Sender<u64>,
    epoch: Arc<str>,
    /// The revisions at which an agent wrote, oldest first.
    agent_writes: Arc<Mutex<VecDeque<u64>>>,
}

impl Default for ChangeFeed {
    fn default() -> Self {
        Self::new()
    }
}

impl ChangeFeed {
    /// A feed at revision 0, in a run of its own.
    pub fn new() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_nanos());
        Self {
            revision: watch::Sender::new(0),
            epoch: format!("{nanos:x}-{:x}", std::process::id()).into(),
            agent_writes: Arc::default(),
        }
    }

    /// Records one committed write by `origin`.
    pub fn bump(&self, origin: WriteOrigin) {
        self.revision.send_modify(|revision| {
            *revision += 1;
            if origin == WriteOrigin::Agent {
                self.remember_agent_write(*revision);
            }
        });
    }

    fn remember_agent_write(&self, revision: u64) {
        let mut writes = self
            .agent_writes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        writes.push_back(revision);
        if writes.len() > AGENT_WRITES_KEPT {
            writes.pop_front();
        }
    }

    /// Who caused the writes after revision `previous` up to `reached`; see
    /// [`ChangeOrigin::between`].
    pub fn origin_between(&self, previous: u64, reached: u64) -> ChangeOrigin {
        let writes: Vec<u64> = self
            .agent_writes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .copied()
            .collect();
        ChangeOrigin::between(previous, reached, &writes)
    }

    /// The revision as it stands.
    pub fn revision(&self) -> u64 {
        *self.revision.borrow()
    }

    /// The name of this run.
    pub fn epoch(&self) -> &str {
        &self.epoch
    }

    /// Waits until the revision is past `after`, and answers it.
    pub async fn after(&self, after: u64) -> u64 {
        let mut receiver = self.revision.subscribe();
        // `wait_for` fails only when the sender is gone, and this feed holds it.
        let reached = match receiver.wait_for(|revision| *revision > after).await {
            Ok(revision) => *revision,
            Err(_) => self.revision(),
        };
        reached
    }

    /// An [`Announce`] that counts a write as an agent's change.
    pub fn announcer(&self) -> Announce {
        let feed = self.clone();
        Arc::new(move |_origin: Option<&str>| feed.bump(WriteOrigin::Agent))
    }
}
