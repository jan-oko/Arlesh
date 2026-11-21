//! [`ReplicaBackend`]: the Backend port served from a copy of the whole board kept in memory
//! (ADR 0017; `docs/spec/client-mode.md`, *The Replica*).
//!
//! Reads are answered by a local [`SqliteBackend`] over the Replica's database, so they are as
//! fast as the app's own. The Replica is kept in step with the server by [`sync`]: a snapshot on
//! every connect, then each event's rows by position, and a whole board again whenever a position
//! or a hash says a row was missed.
//!
//! Every board change reaches the windows the one way a Standalone write does: through the local
//! backend's publisher, which derives the board on the device.

mod forward;
mod http_source;
mod ports;
pub mod source;
pub mod sync;
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod rig;
#[cfg(test)]
mod tests;

use std::{sync::Arc, time::Duration};

use arlesh_core::{
    error::WireError,
    mindmap::publisher::Sink,
    replication::replica::{self, ReplicaError},
};
use tokio::sync::watch;

pub use http_source::HttpSource;
use sync::{Applied, Shared, Syncer};

use crate::{
    http::{read_only_error, ReadOnlyReason},
    sqlite::SqliteBackend,
    Backend,
};

fn unreachable() -> WireError {
    read_only_error(ReadOnlyReason::ServerUnreachable)
}

/// How long a read waits for the first board before it says the server cannot be reached.
const FIRST_BOARD_WAIT: Duration = Duration::from_secs(30);
/// How long a write waits for the Replica to hold what the server answered, before it goes on.
const APPLY_WAIT: Duration = Duration::from_secs(5);

/// A boxed future, as an operation on the server or the Replica returns it.
pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// What a Replica needs to start.
pub struct ReplicaConfig {
    /// The server: its change stream and snapshot.
    pub source: source::SharedSource,
    /// The server as a Backend, which writes are sent to.
    pub remote: Arc<dyn Backend>,
    /// Told each change the Replica's own board makes: the shell turns it into `board-changed`.
    pub sink: Sink,
    /// The runtime the publisher and the sync task run on.
    pub runtime: tokio::runtime::Handle,
    /// When the Replica doubts its rows.
    pub timings: sync::Timings,
}

/// The Backend port over a Replica of the server's board.
pub struct ReplicaBackend {
    shared: Arc<Shared>,
    remote: Arc<dyn Backend>,
    applied: watch::Receiver<Applied>,
}

impl ReplicaBackend {
    /// Opens the Replica's database and starts following the server.
    pub async fn start(config: ReplicaConfig) -> Result<Arc<Self>, ReplicaError> {
        let factory = replica::open_memory().await?;
        let (applied_sender, applied) = watch::channel(Applied::default());
        let shared = Arc::new(Shared {
            local: watch::channel(None).0,
            applied: applied_sender,
        });
        let syncer = Syncer::new(
            factory,
            Arc::clone(&config.source),
            Arc::clone(&shared),
            config.sink,
            config.runtime.clone(),
            config.timings,
        );
        config.runtime.spawn(syncer.run());
        Ok(Arc::new(Self {
            shared,
            remote: config.remote,
            applied,
        }))
    }

    /// The local backend, once the first board is in.
    fn ready(&self) -> Option<Arc<SqliteBackend>> {
        self.shared.local.borrow().clone()
    }

    /// The local backend, waiting for the first board when it is not in yet.
    async fn local(&self) -> Result<Arc<SqliteBackend>, WireError> {
        let mut changes = self.shared.local.subscribe();
        let waited =
            tokio::time::timeout(FIRST_BOARD_WAIT, changes.wait_for(|local| local.is_some())).await;
        match waited {
            Ok(Ok(local)) => local.clone().ok_or_else(unreachable),
            _ => Err(unreachable()),
        }
    }

    /// The server.
    fn remote(&self) -> &Arc<dyn Backend> {
        &self.remote
    }

    /// Sends a write to the server and waits until the Replica holds what the server answered.
    async fn submit<T>(
        &self,
        operation: impl Fn(Arc<dyn Backend>) -> BoxFuture<'static, Result<T, WireError>>,
    ) -> Result<T, WireError> {
        let answer = operation(Arc::clone(&self.remote)).await?;
        self.wait_until_applied().await;
        Ok(answer)
    }

    /// Waits until the Replica holds the newest revision the server has stamped an answer with,
    /// or a few seconds, whichever is first.
    async fn wait_until_applied(&self) {
        let Some(fence) = self.remote.board_fence().await else {
            return;
        };
        let mut applied = self.applied.clone();
        let _ = tokio::time::timeout(APPLY_WAIT, applied.wait_for(|held| held.holds(&fence))).await;
    }
}
