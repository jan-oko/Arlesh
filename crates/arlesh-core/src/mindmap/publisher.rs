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

use chrono::{NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::{
    database::session::SessionFactory,
    error::AppError,
    mcp::events::ChangeFeed,
    replication::{self, rules::wire, SourceDelta, SourceHead, SourceTracker},
};

use super::{
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
/// How many bytes of `source` rows the ring keeps, beside [`RING_BYTES`] of events: the oldest
/// events lose their `source` first, and a Replica that finds none fetches a snapshot.
pub const RING_SOURCE_BYTES: usize = 4 * 1024 * 1024;

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

/// The host's wall clock in the zone the server was told ([`crate::clock`]), else the machine's
/// local zone, ticking half a second past each minute.
pub struct LocalClock;

impl Clock for LocalClock {
    fn now(&self) -> NaiveDateTime {
        crate::clock::now()
    }

    fn next_tick(&self) -> Tick {
        let now = crate::clock::now();
        let into_minute = u64::from(now.nanosecond() / 1_000_000) + 1000 * u64::from(now.second());
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
    /// Where the replicated source rows stand: the change-log position and their hash
    /// ([`crate::replication`]). `None` from a publisher that does not publish rows. A Replica
    /// whose rows are at `source.upto` must hash to `source.hash`; another hash means a row changed
    /// behind the feed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceHead>,
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
    /// Where the replicated source rows stood at this publication, when the publisher publishes them.
    pub source: Option<SourceHead>,
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
            source: self.source.clone(),
        }
    }
}

/// One change event, as the stream and the windows carry it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeEvent {
    /// The publication the event brings a device to.
    pub seq: u64,
    /// The event's JSON as apps before the Replica read it: `{epoch, seq, revision, now, hash,
    /// changes}`, or `reload: true` in place of `changes` when they were too large (ADR 0020,
    /// decision 16). It never holds `source`.
    pub data: Arc<str>,
    /// The `source` object: the changed replicated rows with their positions and hash
    /// ([`crate::replication`]). `None` when the publisher publishes no rows, when the log fell
    /// short of the database (a client must fetch a snapshot), when the rows were too large for one
    /// event, and once the ring's budget for sources has moved past it.
    pub source: Option<Arc<str>>,
}

impl ChangeEvent {
    /// The event as a stream sends it: with `rows`, `data` plus its `source` (when it has one: a
    /// Replica that finds none fetches a snapshot); without, exactly `data`, which is what every
    /// app that predates the Replica reads.
    pub fn wire(&self, rows: bool) -> std::borrow::Cow<'_, str> {
        match (&self.source, rows) {
            (Some(source), true) => {
                let body = self.data.strip_suffix('}').unwrap_or(&self.data);
                std::borrow::Cow::Owned(format!("{body},\"source\":{source}}}"))
            }
            _ => std::borrow::Cow::Borrowed(&self.data),
        }
    }
}

/// The newest write a publication is known to hold: what a writer settles on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoardFence {
    /// The run of the host.
    pub epoch: Arc<str>,
    /// How many writes the host has committed.
    pub revision: u64,
}

/// Where the time of one publication went: the press timing log's numbers (`arlesh::press`).
#[derive(Debug, Clone, Copy, Default)]
pub struct TurnTimings {
    /// Reading the tables the board derives from.
    pub read: Duration,
    /// Deriving the board from them.
    pub derive: Duration,
    /// Finding what changed against the publication before.
    pub diff: Duration,
    /// Writing the event's JSON.
    pub serialize: Duration,
    /// Handing the event to the sink.
    pub emit: Duration,
}

struct State {
    /// The newest publication's timings, by its `seq`.
    timings: Option<(u64, TurnTimings)>,
    latest: Option<Arc<Publication>>,
    digests: BoardDigests,
    /// The replicated rows' hash and position, when this publisher publishes them.
    source: Option<SourceTracker>,
    ring: VecDeque<ChangeEvent>,
    ring_bytes: usize,
    source_bytes: usize,
}

struct Inner {
    feed: ChangeFeed,
    /// Whether this publisher publishes the replicated rows.
    rows: bool,
    /// Names this publisher's hold on the change-log capture.
    owner: String,
    /// Set once the capture is given up: no later turn takes it again.
    stopped: std::sync::atomic::AtomicBool,
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
    ///
    /// It publishes the derived board only and never touches the change log's capture, so the
    /// triggers cost a host with no Replica to serve nothing, and it cannot take the capture from
    /// a server that holds it.
    pub fn start(
        factory: SessionFactory,
        feed: ChangeFeed,
        clock: Arc<dyn Clock>,
        sink: Sink,
        runtime: &tokio::runtime::Handle,
    ) -> Self {
        Self::spawn(factory, feed, clock, sink, runtime, false)
    }

    /// [`start`](Self::start), and each event also carries the replicated source rows it changed
    /// (`source`), with their hash and position, for a client's Replica ([`crate::replication`]).
    ///
    /// On each turn it takes or renews a lease on the capture (refused while another publisher
    /// holds a valid one), drains the log into the publication and deletes what it read, so nothing
    /// accumulates, and compares the hash it keeps with the database's own, read in the same
    /// transaction. A difference means a change the log never held (a writer that was not a
    /// publisher, a lease that lapsed): it starts again from the rows and says so, and every
    /// client fetches a snapshot.
    pub fn start_with_rows(
        factory: SessionFactory,
        feed: ChangeFeed,
        clock: Arc<dyn Clock>,
        sink: Sink,
        runtime: &tokio::runtime::Handle,
    ) -> Self {
        Self::spawn(factory, feed, clock, sink, runtime, true)
    }

    fn spawn(
        factory: SessionFactory,
        feed: ChangeFeed,
        clock: Arc<dyn Clock>,
        sink: Sink,
        runtime: &tokio::runtime::Handle,
        rows: bool,
    ) -> Self {
        let inner = Arc::new(Inner {
            feed: feed.clone(),
            rows,
            owner: uuid::Uuid::now_v7().to_string(),
            stopped: std::sync::atomic::AtomicBool::new(false),
            state: Mutex::new(State {
                timings: None,
                latest: None,
                digests: BoardDigests::default(),
                source: None,
                ring: VecDeque::new(),
                ring_bytes: 0,
                source_bytes: 0,
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

    /// Where the time of the publication `seq` went, while it is the newest.
    pub fn timings_of(&self, seq: u64) -> Option<TurnTimings> {
        lock(&self.inner.state)
            .timings
            .filter(|(held, _)| *held == seq)
            .map(|(_, timings)| timings)
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
        source: None,
    }
}

async fn derive(
    factory: &SessionFactory,
    now: NaiveDateTime,
) -> Result<(MindmapLoad, super::DeriveSplit), AppError> {
    let mut db = factory.begin_read().await?;
    let derived = super::current_timed(&mut db, now).await?;
    db.commit().await?;
    Ok(derived)
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
    let (load, split) = match derive(factory, now).await {
        Ok(derived) => derived,
        Err(error) => {
            tracing::error!(error = %error, "the board could not be derived; keeping the last publication");
            return None;
        }
    };
    // The log is read after the revision, for the same reason: every write the revision counts has
    // committed its rows, so they are in what this takes (and perhaps those of a write the next
    // revision will count, which the next event then carries empty). After the derive, so a derive
    // that fails leaves the log for the next publication.
    let delta = advance_source(inner, factory).await;
    let previous = lock(&inner.state).latest.clone();
    let published = match previous {
        None => seed(inner, load, revision, now),
        Some(previous) => publish(
            inner,
            &previous,
            Derived {
                load,
                revision,
                now,
                split,
            },
            delta.as_ref(),
            trigger,
            sink,
        ),
    };
    match published {
        Ok(()) => Some(revision),
        Err(error) => {
            tracing::error!(error = %error, "the board could not be serialised; keeping the last publication");
            None
        }
    }
}

/// One derive of the board: what it read, and when.
struct Derived {
    load: MindmapLoad,
    revision: u64,
    now: NaiveDateTime,
    split: super::DeriveSplit,
}

fn source_head(inner: &Inner) -> Option<SourceHead> {
    lock(&inner.state).source.as_ref().map(SourceTracker::head)
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
        source: source_head(inner),
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
    derived: Derived,
    delta: Option<&SourceDelta>,
    trigger: &Trigger,
    sink: &Sink,
) -> Result<(), serde_json::Error> {
    let Derived {
        load,
        revision,
        now,
        split,
    } = derived;
    let diffed = std::time::Instant::now();
    let changes = diff(&previous.load, &load)?;
    let diff_time = diffed.elapsed();
    let serialized = std::time::Instant::now();
    let quiet_tick = matches!(trigger, Trigger::Tick) && revision == previous.revision;
    let no_rows = delta.is_none_or(|delta| delta.is_empty() && !delta.resynced);
    if quiet_tick && changes.is_empty() && no_rows {
        return Ok(());
    }
    // The digests are changed in place, not copied: a failure below rebuilds them from the
    // publication before, which still stands.
    let mut digests = std::mem::take(&mut lock(&inner.state).digests);
    digests.apply(&changes);
    let publication = Arc::new(Publication {
        epoch: Arc::clone(&previous.epoch),
        seq: previous.seq + 1,
        revision,
        now,
        hash: digests.total(),
        sums: digests.sums().clone(),
        load,
        source: source_head(inner),
        json: OnceLock::new(),
    });
    // Only the derived changes decide whether apps that predate the Replica get a `reload`: rows
    // that are too large drop `source` from this event alone, which a Replica answers with a
    // snapshot.
    let too_large = changes.wire_len() > MAX_CHANGES_BYTES;
    let written = event_json(&publication, (!too_large).then_some(&changes)).and_then(|data| {
        let source = match delta {
            Some(delta)
                if !too_large
                    && !delta.resynced
                    && wire::event_len(delta) <= MAX_CHANGES_BYTES =>
            {
                Some(Arc::<str>::from(wire::event_source(delta)?))
            }
            _ => None,
        };
        Ok((data, source))
    });
    let (data, source) = match written {
        Ok(written) => written,
        Err(error) => {
            lock(&inner.state).digests =
                BoardDigests::seed(&previous.load).unwrap_or_default();
            return Err(error);
        }
    };
    let serialize_time = serialized.elapsed();
    let event = ChangeEvent {
        seq: publication.seq,
        data: data.into(),
        source,
    };
    {
        let mut state = lock(&inner.state);
        state.digests = digests;
        state.latest = Some(Arc::clone(&publication));
        state.ring_bytes += event.data.len();
        state.source_bytes += event.source.as_ref().map_or(0, |source| source.len());
        state.ring.push_back(event.clone());
        while state.ring.len() > RING_EVENTS || state.ring_bytes > RING_BYTES {
            let Some(dropped) = state.ring.pop_front() else {
                break;
            };
            state.ring_bytes -= dropped.data.len();
            state.source_bytes -= dropped.source.as_ref().map_or(0, |source| source.len());
        }
        let state = &mut *state;
        let mut over = state.source_bytes.saturating_sub(RING_SOURCE_BYTES);
        for old in state.ring.iter_mut() {
            if over == 0 {
                break;
            }
            if let Some(source) = old.source.take() {
                over = over.saturating_sub(source.len());
                state.source_bytes -= source.len();
            }
        }
    }
    tracing::info!(
        seq = event.seq,
        revision,
        bytes = event.data.len(),
        "published board changes"
    );
    let emitted = std::time::Instant::now();
    sink(&event);
    let timings = TurnTimings {
        read: split.read,
        derive: split.derive,
        diff: diff_time,
        serialize: serialize_time,
        emit: emitted.elapsed(),
    };
    lock(&inner.state).timings = Some((publication.seq, timings));
    tracing::info!(
        target: "arlesh::press",
        seq = publication.seq,
        read_ms = timings.read.as_millis() as u64,
        derive_ms = timings.derive.as_millis() as u64,
        diff_ms = timings.diff.as_millis() as u64,
        serialize_ms = timings.serialize.as_millis() as u64,
        emit_ms = timings.emit.as_millis() as u64,
        "publication timings"
    );
    inner.seq.send_replace(publication.seq);
    Ok(())
}

/// One turn of the publisher with the replicated rows: takes or renews the capture, drains the log
/// into the hash it keeps, and checks that hash against the database's own, read in the same
/// transaction. Answers the delta for the event, or `None` for an event with no `source`: this
/// publisher publishes no rows, another holds the capture, or this turn started again from the
/// rows (so every client must fetch a snapshot). When the log cannot be read it answers no change
/// and leaves the log for the next turn.
async fn advance_source(inner: &Inner, factory: &SessionFactory) -> Option<SourceDelta> {
    if !inner.rows || inner.stopped.load(std::sync::atomic::Ordering::SeqCst) {
        return None;
    }
    let turn = async {
        let mut db = factory.begin().await?;
        let turn = replication::take_turn(&mut db, &inner.owner).await?;
        db.commit().await?;
        Ok::<_, sqlx::Error>(turn)
    }
    .await;
    let previous = lock(&inner.state).source.take();
    match turn {
        Err(error) => {
            tracing::error!(error = %error, "the change log could not be read; keeping it for the next publication");
            let mut tracker = previous?;
            let delta = tracker.advance(Vec::new());
            lock(&inner.state).source = Some(tracker);
            Some(delta)
        }
        Ok(replication::Turn::Refused) => {
            tracing::warn!(
                "another publisher holds the change-log capture; publishing without source rows"
            );
            None
        }
        Ok(replication::Turn::Acquired(tracker)) => {
            lock(&inner.state).source = Some(tracker);
            None
        }
        Ok(replication::Turn::Renewed(drained)) => {
            let mut tracker =
                previous.unwrap_or_else(|| SourceTracker::seed(&drained.rows, drained.position));
            let mut delta = tracker.advance(drained.entries.clone());
            let resynced = delta.hash != drained.hash;
            if resynced {
                tracing::error!(
                    feed = %delta.hash,
                    database = %drained.hash,
                    "the replicated rows changed behind the feed; starting again from the database"
                );
                tracker = SourceTracker::seed(&drained.rows, drained.position);
                delta = SourceDelta {
                    base: delta.base,
                    upto: drained.position,
                    hash: tracker.head().hash,
                    rows: Vec::new(),
                    resynced: true,
                };
            }
            lock(&inner.state).source = Some(tracker);
            Some(delta)
        }
    }
}

impl BoardPublisher {
    /// Gives up the change-log capture, at a clean shutdown: the triggers stop logging, and this
    /// publisher never takes it again. Anything that went wrong is logged, and the lease runs out
    /// by itself.
    pub async fn release_capture(&self, factory: &SessionFactory) {
        self.inner
            .stopped
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let released = async {
            let mut db = factory.begin().await?;
            replication::release_capture(&mut db, &self.inner.owner).await?;
            db.commit().await
        }
        .await;
        if let Err(error) = released {
            tracing::warn!(error = %error, "the change-log capture could not be released; it lapses by itself");
        }
    }
}
