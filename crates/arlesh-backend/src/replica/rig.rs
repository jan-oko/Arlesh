//! A server stand-in for the Replica's tests: a real core over an in-memory database that publishes
//! source rows, a [`Bracketed`] backend that brackets each write in a Gesture as the server does per
//! request, and a [`RigSource`] that feeds a Replica from it the way the HTTP stream and snapshot do,
//! with the faults a test asks for.

use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use arlesh_core::{
    error::WireError,
    mindmap::publisher::{Clock, Tick},
    replication::{self, replica},
    undo::{stacks::UndoStacks, GestureAbort, GestureClose, model::GestureId},
};
use tokio::sync::{mpsc, Notify};

use super::source::{Incoming, SourceEvent, SyncSource};
use crate::{http::ReadOnlyReason, sqlite::SqliteBackend, Backend};

/// A clock that ticks only when the test says so.
pub struct Ticker(pub Arc<Notify>);

impl Clock for Ticker {
    fn now(&self) -> chrono::NaiveDateTime {
        arlesh_core::clock::now()
    }

    fn next_tick(&self) -> Tick {
        let notify = Arc::clone(&self.0);
        Box::pin(async move { notify.notified().await })
    }
}

/// The Gesture boundary a server has no use for between requests: what an HTTP client does.
pub struct LocalGestures;

impl LocalGestures {
    async fn open_gesture(&self) -> Result<GestureId, WireError> {
        Ok(GestureId("local".to_owned()))
    }

    async fn close_gesture(&self) -> Result<GestureClose, WireError> {
        Ok(GestureClose::default())
    }

    async fn abort_gesture(&self) -> Result<GestureAbort, WireError> {
        Ok(GestureAbort::default())
    }
}

/// A core that opens a Gesture, runs the call and closes it, per call, as a FastAPI request does.
/// Reads pass through; the Gesture calls themselves are no-ops, as they are over HTTP.
pub struct Bracketed(pub Arc<SqliteBackend>);

macro_rules! bracketed_body {
    (read $s:ident $name:ident [$($arg:ident)*]) => { $s.0.$name($($arg),*).await };
    (option_read $s:ident $name:ident [$($arg:ident)*]) => { $s.0.$name($($arg),*).await };
    (remote_read $s:ident $name:ident [$($arg:ident)*]) => { $s.0.$name($($arg),*).await };
    (refused $s:ident $name:ident [$($arg:ident)*]) => { $s.0.$name($($arg),*).await };
    (undo $s:ident $name:ident [$($arg:ident)*]) => { $s.0.$name($($arg),*).await };
    (local $s:ident $name:ident [$($arg:ident)*]) => { LocalGestures.$name().await };
    (write $s:ident $name:ident [$($arg:ident)*]) => { bracketed_body!(@bracket $s $name [$($arg)*]) };
    (create $s:ident $name:ident [$($arg:ident)*]) => { bracketed_body!(@bracket $s $name [$($arg)*]) };
    (remote $s:ident $name:ident [$($arg:ident)*]) => { bracketed_body!(@bracket $s $name [$($arg)*]) };
    (@bracket $s:ident $name:ident [$($arg:ident)*]) => {{
        $s.0.open_gesture().await?;
        let outcome = $s.0.$name($($arg),*).await;
        match outcome {
            Ok(answer) => {
                $s.0.close_gesture().await?;
                Ok(answer)
            }
            Err(error) => {
                let _ = $s.0.abort_gesture().await;
                Err(error)
            }
        }
    }};
}

macro_rules! implement_bracketed {
    ( $( $port:ident in $module:ident {
            uses { $( $import:item )* }
            methods { $( $kind:ident $name:ident ( $( $arg:ident : $ty:ty ),* ) -> $ret:ty ; )* }
        } )* ) => {
        mod bracketed_impls {
            $(
                pub(super) mod $module {
                    #![allow(unused_imports, clippy::all)]
                    use std::sync::Arc;
                    $( $import )*
                    use super::super::{Bracketed, LocalGestures};
                    use crate::Backend;
                    use crate::$module::$port as _;
                    use crate::undo::UndoPort as _;

                    #[async_trait::async_trait]
                    impl crate::$module::$port for Bracketed {
                        $(
                            async fn $name(&self $(, $arg: $ty)*) -> $ret {
                                bracketed_body!($kind self $name [$($arg)*])
                            }
                        )*
                    }
                }
            )*
        }
    };
}

super::ports::with_ports!(implement_bracketed);

/// The server: a core publishing rows over an in-memory database, and the ways to reach it.
pub struct ServerRig {
    /// The core itself.
    pub backend: Arc<SqliteBackend>,
    /// The core as a request-at-a-time server: what a Replica's writes are sent to.
    pub bracketed: Arc<Bracketed>,
    /// Ticks the server publisher's clock.
    pub ticks: Arc<Notify>,
}

impl ServerRig {
    /// A server over a fresh database.
    pub async fn start() -> Self {
        let factory = replica::open_memory().await.expect("a database");
        let ticks = Arc::new(Notify::new());
        let backend = Arc::new(SqliteBackend::with_rows(
            factory,
            UndoStacks::new(),
            Arc::new(Ticker(Arc::clone(&ticks))),
            Arc::new(|_| {}),
            &tokio::runtime::Handle::current(),
        ));
        // The first publication is the seed: wait for it, so the capture is held.
        backend.publisher().current().await;
        Self {
            bracketed: Arc::new(Bracketed(Arc::clone(&backend))),
            backend,
            ticks,
        }
    }

    /// The sequence number of the newest publication.
    pub fn seq(&self) -> u64 {
        self.backend.publisher().head().map_or(0, |head| head.seq)
    }

    /// Waits for the publication a write is about to make, and answers its sequence number.
    pub async fn published_after(&self, seq: u64) -> u64 {
        let events = self
            .backend
            .publisher()
            .after(seq, Duration::from_secs(10))
            .await;
        events.last().map_or(seq, |event| event.seq)
    }

    /// Every replicated row.
    pub async fn rows(&self) -> Vec<replication::StoredRow> {
        let mut db = self.backend.factory().begin_read().await.expect("a read");
        replication::snapshot(&mut db).await.expect("rows").rows
    }

    /// A statement run straight on the database, behind the feed.
    pub async fn sql(&self, statement: &str) {
        replica::execute_for_tests(self.backend.factory(), statement)
            .await
            .expect("the statement runs");
    }
}

/// What a [`RigSource`] was told.
#[derive(Default)]
pub struct Told {
    /// Every `hold` call, in order.
    pub holds: Mutex<Vec<Option<ReadOnlyReason>>>,
    /// How many times a snapshot was fetched.
    pub snapshots: AtomicU32,
    /// How many times the stream was opened.
    pub opens: AtomicU32,
}

/// A [`SyncSource`] over a [`ServerRig`], with faults.
pub struct RigSource {
    server: Mutex<Arc<SqliteBackend>>,
    dropped: Mutex<HashSet<u64>>,
    generation: Arc<AtomicU32>,
    /// Added to the snapshot's schema version.
    pub schema_skew: AtomicI64,
    /// Whether the stream refuses to open.
    pub down: AtomicBool,
    /// What the Replica told the host.
    pub told: Arc<Told>,
    head_every: Duration,
}

impl RigSource {
    /// A source over `server` that says a head every `head_every` of quiet.
    pub fn new(server: &ServerRig, head_every: Duration) -> Self {
        Self {
            server: Mutex::new(Arc::clone(&server.backend)),
            dropped: Mutex::new(HashSet::new()),
            generation: Arc::new(AtomicU32::new(0)),
            schema_skew: AtomicI64::new(0),
            down: AtomicBool::new(false),
            told: Arc::new(Told::default()),
            head_every,
        }
    }

    /// Never sends the events with these sequence numbers.
    pub fn drop_events(&self, seqs: impl IntoIterator<Item = u64>) {
        self.dropped.lock().expect("lock").extend(seqs);
    }

    /// Ends every open stream, as a lost connection does.
    pub fn break_streams(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    /// Points the source at another core over the same database, as a restarted server is.
    pub fn restart_server(&self, server: Arc<SqliteBackend>) {
        *self.server.lock().expect("lock") = server;
        self.break_streams();
    }

    fn server(&self) -> Arc<SqliteBackend> {
        Arc::clone(&self.server.lock().expect("lock"))
    }
}

#[async_trait::async_trait]
impl SyncSource for RigSource {
    async fn open(&self) -> Result<mpsc::UnboundedReceiver<Incoming>, WireError> {
        if self.down.load(Ordering::SeqCst) {
            return Err(WireError::internal("the rig's server is down"));
        }
        self.told.opens.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::unbounded_channel();
        let server = self.server();
        let generation = Arc::clone(&self.generation);
        let mine = generation.load(Ordering::SeqCst);
        let head_every = self.head_every;
        let dropped = self.dropped.lock().expect("lock").clone();
        tokio::spawn(async move {
            let publisher = server.publisher().clone();
            let mut seen = publisher.head().map_or(0, |head| head.seq);
            if let Some(head) = publisher.head() {
                let _ = sender.send(Incoming::Head(head));
            }
            while generation.load(Ordering::SeqCst) == mine {
                let events = publisher.after(seen, head_every).await;
                if events.is_empty() {
                    if let Some(head) = publisher.head() {
                        if sender.send(Incoming::Head(head)).is_err() {
                            return;
                        }
                    }
                    continue;
                }
                for event in events {
                    seen = event.seq;
                    if dropped.contains(&event.seq) {
                        continue;
                    }
                    let Ok(parsed) = SourceEvent::parse(&event.wire(true)) else {
                        continue;
                    };
                    if sender.send(Incoming::Changed(parsed)).is_err() {
                        return;
                    }
                }
            }
        });
        Ok(receiver)
    }

    async fn snapshot(&self) -> Result<String, WireError> {
        self.told.snapshots.fetch_add(1, Ordering::SeqCst);
        let server = self.server();
        let publisher = server.publisher();
        let epoch = publisher.epoch();
        let revision = publisher.fence().revision;
        let body = replication::device_snapshot(server.factory(), &epoch, revision)
            .await
            .map_err(WireError::from_error)?;
        let skew = self.schema_skew.load(Ordering::SeqCst);
        if skew == 0 {
            return Ok(body);
        }
        let mut value: serde_json::Value =
            serde_json::from_str(&body).map_err(|error| WireError::internal(error.to_string()))?;
        let version = value["schema_version"].as_i64().unwrap_or(0) + skew;
        value["schema_version"] = version.into();
        Ok(value.to_string())
    }

    fn hold(&self, reason: Option<ReadOnlyReason>) {
        self.told.holds.lock().expect("lock").push(reason);
    }

    fn reachable(&self, _reachable: bool) {}
}

/// Dereferences to the core for brevity in tests.
pub fn remote(server: &ServerRig) -> Arc<dyn Backend> {
    Arc::clone(&server.bracketed) as Arc<dyn Backend>
}

/// A server reached over HTTP, as a Backend.
pub fn remote_of(backend: &Arc<crate::http::HttpBackend>) -> Arc<dyn Backend> {
    Arc::clone(backend) as Arc<dyn Backend>
}
