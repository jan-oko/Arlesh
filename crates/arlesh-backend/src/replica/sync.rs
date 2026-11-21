//! Keeping the Replica in step with the server: connect, take a snapshot in, apply each event by
//! its position, and fetch a whole board whenever the positions or the hash say a row was missed
//! (ADR 0017, decisions 4 and 5; `docs/spec/client-mode.md`, *The Replica*).
//!
//! One task owns all of it, so nothing here locks.

use std::{sync::Arc, time::Duration};

use arlesh_core::{
    database::session::SessionFactory,
    error::WireError,
    mindmap::publisher::Sink,
    replication::{
        self, replica,
        rules::{
            apply::{decide, Decision},
            wire,
        },
        RowChange, SourceTracker,
    },
    undo::stacks::UndoStacks,
};
use tokio::{sync::watch, time::Instant};

use super::source::{Incoming, SharedSource, SourceEvent};
use crate::{
    http::ReadOnlyReason,
    revision::{BoardHead, BoardRevision},
    sqlite::SqliteBackend,
};

/// The waits that decide when the Replica doubts its rows. Tests shorten them.
#[derive(Debug, Clone, Copy)]
pub struct Timings {
    /// How long a head may run ahead of the rows held before a snapshot is fetched.
    pub ahead_limit: Duration,
    /// How long the feed must be quiet before the local rows are checked against the tracker.
    pub quiet_before_check: Duration,
    /// How often the local rows are checked against the tracker at the latest.
    pub check_every: Duration,
    /// How often the Replica looks at the clock.
    pub tick: Duration,
    /// The longest wait between two attempts to reach the server.
    pub max_backoff: Duration,
}

impl Default for Timings {
    fn default() -> Self {
        Self {
            ahead_limit: Duration::from_secs(10),
            quiet_before_check: Duration::from_secs(5),
            check_every: Duration::from_secs(600),
            tick: Duration::from_secs(1),
            max_backoff: Duration::from_secs(30),
        }
    }
}

/// The newest revision of the server's current run the Replica holds the rows of.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Applied {
    /// The run of the server.
    pub epoch: String,
    /// The writes the rows hold at least.
    pub revision: u64,
}

impl Applied {
    /// Whether the rows hold the writes `stamp` names.
    pub fn holds(&self, stamp: &BoardRevision) -> bool {
        self.epoch == stamp.epoch && self.revision >= stamp.revision
    }
}

/// What the Replica shares with the callers that read it.
pub struct Shared {
    /// The local backend, made when the first board is in.
    pub local: watch::Sender<Option<Arc<SqliteBackend>>>,
    /// What has been applied.
    pub applied: watch::Sender<Applied>,
}

/// Why a session with the server ended.
#[derive(Debug)]
enum SessionEnd {
    /// The stream closed.
    Closed,
    /// The server could not be asked.
    Failed(WireError),
    /// The server's schema is not this app's: it stays held until it changes.
    SchemaMismatch(ReadOnlyReason),
}

/// The task that keeps the Replica current.
pub struct Syncer {
    pub(super) factory: SessionFactory,
    pub(super) source: SharedSource,
    pub(super) shared: Arc<Shared>,
    sink: Sink,
    runtime: tokio::runtime::Handle,
    timings: Timings,
    epoch: String,
    position: i64,
    tracker: SourceTracker,
    needs_snapshot: bool,
    ahead_since: Option<Instant>,
    last_event: Instant,
    last_check: Instant,
    unchecked: bool,
}

impl Syncer {
    /// A syncer over the Replica's `factory`, not yet connected.
    pub fn new(
        factory: SessionFactory,
        source: SharedSource,
        shared: Arc<Shared>,
        sink: Sink,
        runtime: tokio::runtime::Handle,
        timings: Timings,
    ) -> Self {
        Self {
            factory,
            source,
            shared,
            sink,
            runtime,
            timings,
            epoch: String::new(),
            position: 0,
            tracker: SourceTracker::default(),
            needs_snapshot: false,
            ahead_since: None,
            last_event: Instant::now(),
            last_check: Instant::now(),
            unchecked: false,
        }
    }

    /// Connects, follows the server and, whenever the connection is lost, starts again, for as
    /// long as the app runs.
    pub async fn run(mut self) {
        let mut backoff = Duration::from_secs(1);
        loop {
            match self.session().await {
                SessionEnd::Closed => tracing::info!("the change stream ended; reconnecting"),
                SessionEnd::Failed(error) => {
                    tracing::warn!(error = ?error, "the Replica could not follow the server");
                    self.source.reachable(false);
                }
                SessionEnd::SchemaMismatch(reason) => {
                    tracing::warn!(?reason, "the server's schema is not this app's");
                    self.source.hold(Some(reason));
                }
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(self.timings.max_backoff);
        }
    }

    /// One connection: open the stream, take a snapshot in, then follow until it ends.
    async fn session(&mut self) -> SessionEnd {
        let mut events = match self.source.open().await {
            Ok(events) => events,
            Err(error) => return SessionEnd::Failed(error),
        };
        if let Err(end) = self.install_snapshot().await {
            return end;
        }
        let mut tick = tokio::time::interval(self.timings.tick);
        loop {
            tokio::select! {
                incoming = events.recv() => {
                    let Some(incoming) = incoming else { return SessionEnd::Closed };
                    if let Err(error) = self.on_incoming(incoming).await {
                        return SessionEnd::Failed(error);
                    }
                }
                _ = tick.tick() => {
                    if let Err(error) = self.on_tick().await {
                        return SessionEnd::Failed(error);
                    }
                }
            }
            if self.needs_snapshot {
                if let Err(end) = self.install_snapshot().await {
                    return end;
                }
            }
        }
    }

    /// Fetches the device snapshot and makes the Replica exactly that board.
    async fn install_snapshot(&mut self) -> Result<(), SessionEnd> {
        self.needs_snapshot = false;
        let body = self.source.snapshot().await.map_err(SessionEnd::Failed)?;
        let parsed = wire::parse_snapshot(&body)
            .map_err(|error| SessionEnd::Failed(WireError::internal(error.to_string())))?;
        let ours = replica::schema_version(&self.factory)
            .await
            .map_err(|error| SessionEnd::Failed(WireError::internal(error.to_string())))?;
        if parsed.snapshot.schema_version != ours {
            return Err(SessionEnd::SchemaMismatch(
                if parsed.snapshot.schema_version > ours {
                    ReadOnlyReason::UpdateApp
                } else {
                    ReadOnlyReason::UpdateServer
                },
            ));
        }
        replica::install_snapshot(&self.factory, &parsed.snapshot)
            .await
            .map_err(|error| SessionEnd::Failed(WireError::internal(error.to_string())))?;
        self.tracker = SourceTracker::seed(&parsed.snapshot.rows, parsed.snapshot.upto);
        self.position = parsed.snapshot.upto;
        self.epoch = parsed.epoch.clone();
        self.ahead_since = None;
        self.unchecked = false;
        self.last_event = Instant::now();
        self.source.hold(None);
        self.source.reachable(true);
        self.announce();
        self.shared.applied.send_replace(Applied {
            epoch: parsed.epoch,
            revision: parsed.revision,
        });
        Ok(())
    }

    /// Makes the local backend when the first board is in, and tells it a write landed.
    fn announce(&self) {
        if let Some(local) = self.shared.local.borrow().clone() {
            local.record_write();
            return;
        }
        // The publisher starts here, after the first board is in, so it never shows the
        // baseline's seed rows.
        let local = Arc::new(SqliteBackend::new(
            self.factory.clone(),
            UndoStacks::new(),
            Arc::clone(&self.sink),
            &self.runtime,
        ));
        self.shared.local.send_replace(Some(local));
    }

    async fn on_incoming(&mut self, incoming: Incoming) -> Result<(), WireError> {
        match incoming {
            Incoming::Changed(event) => self.on_event(event).await,
            Incoming::Head(head) => {
                self.on_head(head);
                Ok(())
            }
        }
    }

    async fn on_event(&mut self, event: SourceEvent) -> Result<(), WireError> {
        self.last_event = Instant::now();
        if event.epoch != self.epoch {
            self.needs_snapshot = true;
            return Ok(());
        }
        let Some(delta) = event.source else {
            self.needs_snapshot = true;
            return Ok(());
        };
        let skip_through = match decide(self.position, delta.base, delta.upto) {
            Decision::Gap => {
                self.needs_snapshot = true;
                return Ok(());
            }
            Decision::Held => {
                self.note_revision(&event.epoch, event.revision);
                return Ok(());
            }
            Decision::Apply { skip_through } => skip_through,
        };
        let fresh: Vec<RowChange> = delta
            .rows
            .into_iter()
            .filter(|row| row.seq > skip_through)
            .collect();
        replica::apply_rows(&self.factory, &fresh)
            .await
            .map_err(|error| WireError::internal(error.to_string()))?;
        let after = self.tracker.advance(fresh);
        self.position = delta.upto;
        self.unchecked = true;
        if after.hash != delta.hash {
            tracing::error!(
                held = %after.hash,
                said = %delta.hash,
                "the Replica's rows do not hash as the server said; fetching a snapshot"
            );
            self.needs_snapshot = true;
        }
        self.announce();
        self.note_revision(&event.epoch, event.revision);
        Ok(())
    }

    fn note_revision(&self, epoch: &str, revision: u64) {
        self.shared.applied.send_if_modified(|applied| {
            if applied.epoch == epoch && applied.revision >= revision {
                return false;
            }
            applied.epoch = epoch.to_owned();
            applied.revision = revision;
            true
        });
    }

    fn on_head(&mut self, head: BoardHead) {
        if head.epoch != self.epoch {
            self.needs_snapshot = true;
            return;
        }
        let Some(source) = head.source else { return };
        if source.upto > self.position {
            self.ahead_since.get_or_insert_with(Instant::now);
            return;
        }
        self.ahead_since = None;
        if source.upto == self.position && source.hash != self.tracker.head().hash {
            tracing::error!("a row changed behind the feed; fetching a snapshot");
            self.needs_snapshot = true;
        }
    }

    async fn on_tick(&mut self) -> Result<(), WireError> {
        if self
            .ahead_since
            .is_some_and(|since| since.elapsed() >= self.timings.ahead_limit)
        {
            self.ahead_since = None;
            self.needs_snapshot = true;
            return Ok(());
        }
        let quiet = self.last_event.elapsed() >= self.timings.quiet_before_check;
        let due = (self.unchecked && quiet) || self.last_check.elapsed() >= self.timings.check_every;
        if !due || !self.can_check() {
            return Ok(());
        }
        self.last_check = Instant::now();
        self.unchecked = false;
        let mut db = self
            .factory
            .begin_read()
            .await
            .map_err(WireError::from_error)?;
        let held = replication::board_hash(&mut db)
            .await
            .map_err(WireError::from_error)?;
        if held != self.tracker.head().hash {
            tracing::error!("the Replica's own rows do not hash as its tracker; fetching a snapshot");
            self.needs_snapshot = true;
        }
        Ok(())
    }

    /// Whether the rows are all confirmed ones, so their hash means something.
    fn can_check(&self) -> bool {
        true
    }
}
