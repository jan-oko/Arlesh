//! The change feed: a counter of the board's committed writes, and the run of the host it counts in.

use std::sync::Arc;

use tokio::sync::watch;

use crate::board::Announce;

/// The board's **revision**: bumped once for every committed write the host hears of, with the
/// **epoch** that names this run of the host (the revision starts again at 0 when it restarts).
#[derive(Clone)]
pub struct ChangeFeed {
    revision: watch::Sender<u64>,
    epoch: Arc<str>,
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
        }
    }

    /// Records one committed write.
    pub fn bump(&self) {
        self.revision.send_modify(|revision| *revision += 1);
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

    /// An [`Announce`] that counts a write as a change.
    pub fn announcer(&self) -> Announce {
        let feed = self.clone();
        Arc::new(move |_origin: Option<&str>| feed.bump())
    }
}
