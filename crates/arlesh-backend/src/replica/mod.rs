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

pub mod cache;
mod forward;
mod http_source;
#[cfg(test)]
mod http_tests;
pub mod mint;
#[cfg(test)]
mod paint_tests;
mod ports;
pub mod press;
pub mod queue;
#[cfg(test)]
mod rig;
pub mod source;
pub mod sync;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod write_tests;

use std::{sync::Arc, time::Duration};

use arlesh_core::{
    error::WireError,
    mindmap::publisher::Sink,
    replication::replica::{self, ReplicaError},
};
use arlesh_core::{nodes::id::RowId, undo::model::GestureSummary};
use tokio::sync::{mpsc, oneshot, watch};

pub use http_source::HttpSource;
use sync::{Applied, Shared, Syncer};

use crate::{
    http::{read_only_error, ReadOnlyReason},
    sqlite::SqliteBackend,
    Backend,
};

/// A boxed future, as an operation on the server or the Replica returns it.
pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// Runs `work` as the write that has `seed`: every id it makes comes from the seed, so the same
/// write on the server makes the same ids.
pub(crate) async fn seeded<T>(seed: RowId, work: impl std::future::Future<Output = T>) -> T {
    arlesh_core::nodes::new_id::with_seed(seed, work).await
}

/// What a Replica needs to start.
pub struct ReplicaConfig {
    /// The server: its change stream and snapshot.
    pub source: source::SharedSource,
    /// The server as a Backend, which writes are sent to.
    pub remote: Arc<dyn Backend>,
    /// Told each change the Replica's own board makes: the shell turns it into `board-changed`.
    pub sink: Sink,
    /// Told when writes were taken back: the shell turns it into one notice.
    pub on_dropped: queue::OnDropped,
    /// The runtime the publisher and the sync task run on.
    pub runtime: tokio::runtime::Handle,
    /// When the Replica doubts its rows.
    pub timings: sync::Timings,
    /// The board kept from the last run, shown until the server's arrives; `None` keeps none.
    pub cache: Option<cache::SharedCache>,
}

/// How long saving the board waits for the Replica to answer.
const SAVE_WAIT: Duration = Duration::from_secs(3);

fn unreachable() -> WireError {
    read_only_error(ReadOnlyReason::ServerUnreachable)
}

/// How long a read waits for the first board before it says the server cannot be reached.
const FIRST_BOARD_WAIT: Duration = Duration::from_secs(30);

/// The caller's end of a write: it receives the answer once.
struct Slot<T>(Arc<std::sync::Mutex<Option<Answer<T>>>>);

/// The sender of a write's answer.
type Answer<T> = oneshot::Sender<Result<T, WireError>>;

impl<T> Clone for Slot<T> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}

impl<T> Slot<T> {
    fn new() -> (Self, oneshot::Receiver<Result<T, WireError>>) {
        let (sender, receiver) = oneshot::channel();
        (
            Self(Arc::new(std::sync::Mutex::new(Some(sender)))),
            receiver,
        )
    }

    fn send(&self, answer: Result<T, WireError>) {
        let sender = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(sender) = sender {
            let _ = sender.send(answer);
        }
    }
}

/// The Backend port over a Replica of the server's board.
pub struct ReplicaBackend {
    shared: Arc<Shared>,
    remote: Arc<dyn Backend>,
    commands: mpsc::UnboundedSender<queue::Command>,
    cache: Option<cache::SharedCache>,
}

impl ReplicaBackend {
    /// Opens the Replica's database and starts following the server.
    pub async fn start(config: ReplicaConfig) -> Result<Arc<Self>, ReplicaError> {
        let factory = replica::open_memory().await?;
        let (applied, _) = watch::channel(Applied::default());
        let shared = Arc::new(Shared {
            local: watch::channel(None).0,
            applied,
            presses: std::sync::Mutex::default(),
        });
        let cache = config.cache.clone();
        let (commands_tx, commands) = mpsc::unbounded_channel();
        let syncer = Syncer::new(
            factory,
            Arc::clone(&config.source),
            Arc::clone(&config.remote),
            Arc::clone(&shared),
            sync::Wiring {
                commands,
                commands_tx: commands_tx.clone(),
                on_dropped: config.on_dropped,
                sink: config.sink,
                runtime: config.runtime.clone(),
                timings: config.timings,
                cache: config.cache,
            },
        );
        let running = config.runtime.spawn(syncer.run());
        // The actor owns the board's state: if it ever panics the app must not go on looking
        // reachable and writable, so the status says the server cannot be reached.
        let watched = Arc::clone(&config.source);
        config.runtime.spawn(async move {
            if let Err(error) = running.await {
                tracing::error!(error = %error, "the Replica's sync task stopped");
                watched.hold(Some(ReadOnlyReason::ServerUnreachable));
                watched.reachable(false);
            }
        });
        Ok(Arc::new(Self {
            shared,
            remote: config.remote,
            commands: commands_tx,
            cache,
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

    /// Stops following the server and drops the connection, as a phone does in the background.
    /// Writes not yet answered are taken back.
    pub fn suspend(&self) {
        let _ = self.commands.send(queue::Command::Pause(true));
    }

    /// Follows the server again: connects and takes a whole board in.
    pub fn resume(&self) {
        let _ = self.commands.send(queue::Command::Pause(false));
    }

    /// The board as the server last confirmed it, as a snapshot body for the cache: writes not yet
    /// answered are taken back first. `None` when no board is in yet.
    pub async fn confirmed_board(&self) -> Option<String> {
        let (reply, answer) = oneshot::channel();
        self.commands.send(queue::Command::Persist(reply)).ok()?;
        answer.await.ok().flatten()
    }

    /// Where the time of the last presses went, oldest first: what the `arlesh::press` log line
    /// says, kept for a test or a debug view to read.
    pub fn press_timings(&self) -> Vec<press::PressTiming> {
        self.shared
            .presses
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .copied()
            .collect()
    }

    /// The newest write that has not been sent yet, as an undo would report it.
    async fn unsent_tail(&self) -> Option<GestureSummary> {
        let (reply, answer) = oneshot::channel();
        self.commands.send(queue::Command::UnsentTail(reply)).ok()?;
        answer.await.ok().flatten()
    }

    /// Writes the board the server last confirmed to the cache, for the next start: what a normal
    /// quit does, and a suspend on a phone. When the Replica cannot answer within a few seconds
    /// (it is in the middle of fetching a board) the cache is left exactly as it was.
    pub async fn save_board(&self) {
        let confirmed = tokio::time::timeout(SAVE_WAIT, self.confirmed_board())
            .await
            .ok()
            .flatten();
        let (Some(cache), Some(body)) = (&self.cache, confirmed) else {
            return;
        };
        if let Err(error) = cache.store(&body) {
            tracing::warn!(error = %error, "the board could not be cached");
        }
    }

    /// The server.
    fn remote(&self) -> &Arc<dyn Backend> {
        &self.remote
    }

    fn enqueue(&self, op: queue::Op) -> Result<(), WireError> {
        self.commands
            .send(queue::Command::Submit(op))
            .map_err(|_| unreachable())
    }

    /// A write that is predicted: run on the Replica at once, so the caller is answered from there
    /// and the board changes, then sent to the server in its turn.
    async fn predict<T, F>(&self, args: serde_json::Value, operation: F) -> Result<T, WireError>
    where
        T: serde::Serialize + Send + 'static,
        F: Fn(Arc<dyn Backend>) -> BoxFuture<'static, Result<T, WireError>> + Send + Sync + 'static,
    {
        let (slot, answer) = Slot::new();
        let operation = Arc::new(operation);
        let local: queue::LocalFn = {
            let (operation, slot) = (Arc::clone(&operation), slot.clone());
            Arc::new(move |backend| {
                let (work, slot) = (operation(backend), slot.clone());
                Box::pin(async move {
                    let result = work.await;
                    let applied = result.as_ref().map(queue::material).map_err(Clone::clone);
                    slot.send(result);
                    applied
                })
            })
        };
        let remote: queue::RemoteFn = Arc::new(move |backend| {
            let work = operation(backend);
            Box::pin(async move {
                work.await
                    .map(|answer| (Box::new(|| {}) as queue::Deliver, queue::material(&answer)))
            })
        });
        let fail_slot = slot.clone();
        self.enqueue(queue::Op {
            local: Some(local),
            remote,
            fail: Some(Box::new(move |error| fail_slot.send(Err(error)))),
            args,
            submitted: std::time::Instant::now(),
            undo: None,
            redo: false,
        })?;
        answer.await.unwrap_or_else(|_| Err(unreachable()))
    }

    /// A request only the server can answer, which waits until the Replica is settled and then
    /// answers with what the server did.
    async fn remote_item<T, F>(&self, args: serde_json::Value, operation: F) -> Result<T, WireError>
    where
        T: Send + 'static,
        F: Fn(Arc<dyn Backend>) -> BoxFuture<'static, Result<T, WireError>> + Send + Sync + 'static,
    {
        let (slot, answer) = Slot::new();
        let fail_slot = slot.clone();
        self.enqueue(queue::Op {
            local: None,
            remote: delivering(slot, operation),
            fail: Some(Box::new(move |error| fail_slot.send(Err(error)))),
            args,
            submitted: std::time::Instant::now(),
            undo: None,
            redo: false,
        })?;
        answer.await.unwrap_or_else(|_| Err(unreachable()))
    }

    /// Undo or redo: asked of the server once the Replica is settled, except an undo of the newest
    /// write when it is still unsent, which is cancelled on the Replica and sent nowhere.
    async fn undo_item<F>(
        &self,
        args: serde_json::Value,
        is_undo: bool,
        operation: F,
    ) -> Result<Option<GestureSummary>, WireError>
    where
        F: Fn(Arc<dyn Backend>) -> BoxFuture<'static, Result<Option<GestureSummary>, WireError>>
            + Send
            + Sync
            + 'static,
    {
        let (slot, answer) = Slot::new();
        let (fail_slot, cancel_slot) = (slot.clone(), slot.clone());
        self.enqueue(queue::Op {
            local: None,
            remote: delivering(slot, operation),
            fail: Some(Box::new(move |error| fail_slot.send(Err(error)))),
            args,
            submitted: std::time::Instant::now(),
            undo: Some(queue::UndoAnswer {
                answer: Box::new(move |summary| cancel_slot.send(Ok(summary))),
            }),
            redo: !is_undo,
        })?;
        answer.await.unwrap_or_else(|_| Err(unreachable()))
    }
}

/// The server's side of a request whose answer is delivered when the Replica is settled.
fn delivering<T, F>(slot: Slot<T>, operation: F) -> queue::RemoteFn
where
    T: Send + 'static,
    F: Fn(Arc<dyn Backend>) -> BoxFuture<'static, Result<T, WireError>> + Send + Sync + 'static,
{
    Arc::new(move |backend| {
        let (work, slot) = (operation(backend), slot.clone());
        Box::pin(async move {
            work.await.map(|value| {
                (
                    Box::new(move || slot.send(Ok(value))) as queue::Deliver,
                    serde_json::Value::Null,
                )
            })
        })
    })
}
