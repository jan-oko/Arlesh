//! The board publisher: derives the board after every committed write and every minute, compares
//! it with the one before, and tells whoever listens what changed (ADR 0020).
//!
//! One publisher runs per database file, in the host (the server, the desktop's Standalone backend,
//! later the client's replica). It keeps the **latest publication** and a ring of the last change
//! events, so a device that dropped off the stream is caught up with the events it missed instead
//! of a full load.

use std::{
    collections::{BTreeMap, VecDeque},
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::{database::session::SessionFactory, error::AppError, mcp::events::ChangeFeed};

use super::{
    current,
    model::MindmapLoad,
    rules::changes::{diff, BoardChanges, BoardDigests, Collection},
};

#[cfg(test)]
mod tests;

/// Past this size a publication's changes are not sent: the event says `reload` and the clients
/// load the whole board instead (ADR 0020, decision 16).
pub const MAX_CHANGES_BYTES: usize = 256 * 1024;
/// How many change events the ring keeps for a reconnecting device.
pub const RING_EVENTS: usize = 64;
/// How many bytes of events the ring keeps.
pub const RING_BYTES: usize = 4 * 1024 * 1024;

/// What a host does with each change event: the server's stream pulls with
/// [`BoardPublisher::after`] and passes a sink that does nothing; the desktop emits to its windows.
pub type Sink = Arc<dyn Fn(&ChangeEvent) + Send + Sync>;

/// A boxed future, for [`Clock::next_tick`].
pub type Tick = Pin<Box<dyn Future<Output = ()> + Send>>;

/// The publisher's clock: what time the board is derived at, and when the next time-based look is
/// due.
pub trait Clock: Send + Sync {
    /// The wall-clock time the board is derived at.
    fn now(&self) -> NaiveDateTime;
    /// Resolves at the next tick: the next look for what time alone changed.
    fn next_tick(&self) -> Tick;
}

/// The host's local wall clock, ticking half a second past each minute.
pub struct LocalClock;

impl Clock for LocalClock {
    fn now(&self) -> NaiveDateTime {
        chrono::Local::now().naive_local()
    }

    fn next_tick(&self) -> Tick {
        let now = chrono::Local::now();
        let into_minute = u64::from(now.timestamp_subsec_millis())
            + 1000 * u64::from(chrono::Timelike::second(&now));
        let wait = (60_000 + 500 - into_minute) % 60_000;
        // Never zero: a tick that fires at once would loop.
        let wait = if wait == 0 { 60_000 } else { wait };
        Box::pin(tokio::time::sleep(Duration::from_millis(wait)))
    }
}

/// The board hash and per-collection sums a head carries. Sums are keyed by collection name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardHead {
    /// The run of the host the publication belongs to.
    pub epoch: String,
    /// The publication's number within the epoch.
    pub seq: u64,
    /// How many committed writes the publication's board holds at least.
    pub revision: u64,
    /// The board hash: the sum of every entry's digest.
    pub hash: u32,
    /// The sum of each collection's digests, for diagnosing a mismatch.
    pub sums: BTreeMap<String, u32>,
}

/// One publication: the derived board and what identifies it.
pub struct Publication {
    /// The run of the host.
    pub epoch: Arc<str>,
    /// The publication's number within the epoch: the first is 1, one more for each after.
    pub seq: u64,
    /// The writes the board holds at least (the feed's revision read before the derive began).
    pub revision: u64,
    /// The wall-clock time the board was derived at.
    pub now: NaiveDateTime,
    /// The board hash.
    pub hash: u32,
    /// The sum of each collection's digests.
    pub sums: BTreeMap<Collection, u32>,
    /// The derived board.
    pub load: MindmapLoad,
    json: OnceLock<Arc<str>>,
}

impl Publication {
    /// The whole board as JSON, serialised once, the first time it is asked for.
    pub fn json(&self) -> Result<Arc<str>, serde_json::Error> {
        if let Some(json) = self.json.get() {
            return Ok(Arc::clone(json));
        }
        let json: Arc<str> = serde_json::to_string(&self.load)?.into();
        Ok(Arc::clone(self.json.get_or_init(|| json)))
    }

    /// The publication's identity, without its board.
    pub fn head(&self) -> BoardHead {
        BoardHead {
            epoch: self.epoch.to_string(),
            seq: self.seq,
            revision: self.revision,
            hash: self.hash,
            sums: self
                .sums
                .iter()
                .map(|(collection, sum)| (collection.as_str().to_string(), *sum))
                .collect(),
        }
    }
}

/// One change event, as the stream and the windows carry it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeEvent {
    /// The publication the event brings a device to.
    pub seq: u64,
    /// The event's JSON: `{epoch, seq, revision, now, hash, changes}`, or `reload: true` in place
    /// of `changes` when they were too large (ADR 0020, decision 16).
    pub data: Arc<str>,
}

/// The newest write a publication is known to hold: what a writer settles on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoardFence {
    /// The run of the host.
    pub epoch: Arc<str>,
    /// How many writes the host has committed.
    pub revision: u64,
}

struct State {
    latest: Option<Arc<Publication>>,
    digests: BoardDigests,
    ring: VecDeque<ChangeEvent>,
    ring_bytes: usize,
}

struct Inner {
    feed: ChangeFeed,
    state: Mutex<State>,
    seq: watch::Sender<u64>,
}

/// Publishes the board's changes. Cheap to clone: every clone is the same publisher.
#[derive(Clone)]
pub struct BoardPublisher {
    inner: Arc<Inner>,
}

enum Trigger {
    Write,
    Tick,
}

impl BoardPublisher {
    /// Starts publishing on `runtime`: derives the first publication at once, then again after
    /// each write `feed` counts and at each tick of `clock`, telling `sink` about every change.
    pub fn start(
        factory: SessionFactory,
        feed: ChangeFeed,
        clock: Arc<dyn Clock>,
        sink: Sink,
        runtime: &tokio::runtime::Handle,
    ) -> Self {
        let inner = Arc::new(Inner {
            feed: feed.clone(),
            state: Mutex::new(State {
                latest: None,
                digests: BoardDigests::default(),
                ring: VecDeque::new(),
                ring_bytes: 0,
            }),
            seq: watch::Sender::new(0),
        });
        runtime.spawn(run(Arc::downgrade(&inner), factory, feed, clock, sink));
        Self { inner }
    }

    /// Counts a committed write, which the publisher will derive and publish.
    pub fn record_write(&self) {
        self.inner.feed.bump();
    }

    /// The newest revision any write reached, in this run.
    pub fn fence(&self) -> BoardFence {
        BoardFence {
            epoch: self.epoch(),
            revision: self.inner.feed.revision(),
        }
    }

    /// The run of the host: the feed's epoch.
    pub fn epoch(&self) -> Arc<str> {
        Arc::from(self.inner.feed.epoch())
    }

    /// The latest publication, waiting for the first.
    pub async fn current(&self) -> Arc<Publication> {
        let mut seq = self.inner.seq.subscribe();
        loop {
            if let Some(latest) = self.latest() {
                return latest;
            }
            if seq.changed().await.is_err() {
                // The sender lives in `inner`, which this handle holds.
                tokio::task::yield_now().await;
            }
        }
    }

    /// The latest publication's identity, if there is one yet.
    pub fn head(&self) -> Option<BoardHead> {
        self.latest().map(|publication| publication.head())
    }

    /// The events after publication `seq`, in order, once there are some.
    ///
    /// When the ring no longer holds them all (or `seq` is not one this run has published) the
    /// answer is one synthesised `reload` event at the latest publication. With none yet, waits up
    /// to `wait` for the next one and answers empty if it does not come.
    pub async fn after(&self, seq: u64, wait: Duration) -> Vec<ChangeEvent> {
        let mut changed = self.inner.seq.subscribe();
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            if let Some(events) = self.events_after(seq) {
                return events;
            }
            if tokio::time::timeout_at(deadline, changed.changed())
                .await
                .is_err()
            {
                return Vec::new();
            }
        }
    }

    fn latest(&self) -> Option<Arc<Publication>> {
        lock(&self.inner.state).latest.clone()
    }

    /// The events to send a device at `seq`: none to say so when it is up to date.
    fn events_after(&self, seq: u64) -> Option<Vec<ChangeEvent>> {
        let state = lock(&self.inner.state);
        let latest = state.latest.as_ref()?;
        if seq == latest.seq {
            return None;
        }
        let first = state.ring.front().map(|event| event.seq);
        let held = seq < latest.seq && first.is_some_and(|first| first <= seq + 1);
        if held {
            return Some(
                state
                    .ring
                    .iter()
                    .filter(|event| event.seq > seq)
                    .cloned()
                    .collect(),
            );
        }
        Some(vec![reload_event(latest)])
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // A panic while publishing leaves the state itself intact.
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn event_json(
    publication: &Publication,
    changes: Option<&BoardChanges>,
) -> Result<String, serde_json::Error> {
    let body = match changes {
        Some(changes) => format!(",\"changes\":{}", changes.to_json()?),
        None => ",\"reload\":true".to_string(),
    };
    Ok(format!(
        "{{\"epoch\":{},\"seq\":{},\"revision\":{},\"now\":{},\"hash\":{}{}}}",
        serde_json::to_string(&*publication.epoch)?,
        publication.seq,
        publication.revision,
        serde_json::to_string(&publication.now)?,
        publication.hash,
        body
    ))
}

fn reload_event(publication: &Publication) -> ChangeEvent {
    let data = event_json(publication, None).unwrap_or_else(|_| "{\"reload\":true}".to_string());
    ChangeEvent {
        seq: publication.seq,
        data: data.into(),
    }
}

async fn derive(factory: &SessionFactory, now: NaiveDateTime) -> Result<MindmapLoad, AppError> {
    let mut db = factory.begin_read().await?;
    let load = current(&mut db, now).await?;
    db.commit().await?;
    Ok(load)
}

async fn run(
    inner: Weak<Inner>,
    factory: SessionFactory,
    feed: ChangeFeed,
    clock: Arc<dyn Clock>,
    sink: Sink,
) {
    let mut trigger = Trigger::Write;
    loop {
        let Some(strong) = inner.upgrade() else {
            return;
        };
        let published = turn(&strong, &factory, clock.as_ref(), &sink, &trigger).await;
        let seen = published
            .or_else(|| {
                lock(&strong.state)
                    .latest
                    .as_ref()
                    .map(|latest| latest.revision)
            })
            .unwrap_or(0);
        drop(strong);
        let writes = Box::pin(feed.after(seen));
        let ticks = clock.next_tick();
        trigger = match futures_util::future::select(writes, ticks).await {
            futures_util::future::Either::Left(_) => Trigger::Write,
            futures_util::future::Either::Right(_) => Trigger::Tick,
        };
    }
}

/// One derive: publishes when there is something to say, and answers the revision it read.
async fn turn(
    inner: &Inner,
    factory: &SessionFactory,
    clock: &dyn Clock,
    sink: &Sink,
    trigger: &Trigger,
) -> Option<u64> {
    // Read before the derive begins: the feed is bumped only after a write commits, so the board
    // holds at least the writes this revision counts.
    let revision = inner.feed.revision();
    let now = clock.now();
    tracing::debug!(revision, "deriving the board");
    let load = match derive(factory, now).await {
        Ok(load) => load,
        Err(error) => {
            tracing::error!(error = %error, "the board could not be derived; keeping the last publication");
            return None;
        }
    };
    let previous = lock(&inner.state).latest.clone();
    let published = match previous {
        None => seed(inner, load, revision, now),
        Some(previous) => publish(inner, &previous, load, revision, now, trigger, sink),
    };
    match published {
        Ok(()) => Some(revision),
        Err(error) => {
            tracing::error!(error = %error, "the board could not be serialised; keeping the last publication");
            None
        }
    }
}

fn seed(
    inner: &Inner,
    load: MindmapLoad,
    revision: u64,
    now: NaiveDateTime,
) -> Result<(), serde_json::Error> {
    let digests = BoardDigests::seed(&load)?;
    let publication = Arc::new(Publication {
        epoch: Arc::from(inner.feed.epoch()),
        seq: 1,
        revision,
        now,
        hash: digests.total(),
        sums: digests.sums().clone(),
        load,
        json: OnceLock::new(),
    });
    {
        let mut state = lock(&inner.state);
        state.digests = digests;
        state.latest = Some(publication);
    }
    inner.seq.send_replace(1);
    Ok(())
}

fn publish(
    inner: &Inner,
    previous: &Publication,
    load: MindmapLoad,
    revision: u64,
    now: NaiveDateTime,
    trigger: &Trigger,
    sink: &Sink,
) -> Result<(), serde_json::Error> {
    let changes = diff(&previous.load, &load)?;
    let quiet_tick = matches!(trigger, Trigger::Tick) && revision == previous.revision;
    if quiet_tick && changes.is_empty() {
        return Ok(());
    }
    let mut digests = lock(&inner.state).digests.clone();
    digests.apply(&changes);
    let publication = Arc::new(Publication {
        epoch: Arc::clone(&previous.epoch),
        seq: previous.seq + 1,
        revision,
        now,
        hash: digests.total(),
        sums: digests.sums().clone(),
        load,
        json: OnceLock::new(),
    });
    let too_large = changes.wire_len() > MAX_CHANGES_BYTES;
    let data = event_json(&publication, (!too_large).then_some(&changes))?;
    let event = ChangeEvent {
        seq: publication.seq,
        data: data.into(),
    };
    {
        let mut state = lock(&inner.state);
        state.digests = digests;
        state.latest = Some(Arc::clone(&publication));
        state.ring_bytes += event.data.len();
        state.ring.push_back(event.clone());
        while state.ring.len() > RING_EVENTS || state.ring_bytes > RING_BYTES {
            let Some(dropped) = state.ring.pop_front() else {
                break;
            };
            state.ring_bytes -= dropped.data.len();
        }
    }
    tracing::info!(
        seq = event.seq,
        revision,
        bytes = event.data.len(),
        "published board changes"
    );
    sink(&event);
    inner.seq.send_replace(publication.seq);
    Ok(())
}
