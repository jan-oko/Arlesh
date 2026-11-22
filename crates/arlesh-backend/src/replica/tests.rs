//! The Replica against a server stand-in: kept in step event by event, repaired when an event is
//! missed or a row changes behind the feed, and held read-only when the schemas differ.

use std::{
    collections::BTreeSet,
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};

use arlesh_core::{
    domains::model::{CreateDomainRequest, DomainSubtype},
    mindmap::publisher::ChangeEvent,
    nodes::id::NodeId,
    replication::StoredRow,
    tasks::model::{CreateTaskRequest, UpdateTaskRequest},
};

use super::{
    cache::CacheStore,
    queue::Dropped,
    rig::{gated, remote, Gated, RigSource, ServerRig},
    sync::Timings,
    ReplicaBackend, ReplicaConfig,
};
use crate::{
    domains::DomainsPort, http::ReadOnlyReason, sqlite::SqliteBackend, tasks::TasksPort, Backend,
};

const CONTRACT: &str = include_str!("../../../../conformance/client-mode.json");
const PORTS: &str = include_str!("ports.rs");

/// Methods that are `POST`s but only ask a question of the board: the what-ifs.
const WHAT_IFS: &[&str] = &[
    "plan_containment_conflicts",
    "scope_containment_conflicts",
    "scope_valid_flow_targets",
    "flow_origins",
];

/// Every `kind name(` line of the port list.
fn kinds() -> Vec<(String, String)> {
    PORTS
        .lines()
        .filter_map(|line| {
            let (kind, rest) = line.trim().split_once(' ')?;
            if ![
                "read",
                "option_read",
                "write",
                "create",
                "remote",
                "remote_read",
                "status_read",
                "local",
                "undo",
                "refused",
            ]
            .contains(&kind)
            {
                return None;
            }
            let name: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            rest.contains('(').then(|| (name, kind.to_owned()))
        })
        .collect()
}

#[test]
fn every_non_get_route_is_a_write_kind() {
    let contract: serde_json::Value = serde_json::from_str(CONTRACT).expect("JSON");
    let routes = contract["routes"].as_object().expect("routes");
    let kinds = kinds();
    assert!(kinds.len() > 120, "the port list was read: {}", kinds.len());
    for (name, kind) in kinds {
        let Some(verbs) = routes.get(&name) else {
            continue;
        };
        let writes = verbs
            .as_array()
            .expect("verbs")
            .iter()
            .any(|verb| !verb.as_str().unwrap_or("").starts_with("GET"));
        let predicted = ["write", "create", "remote", "undo"].contains(&kind.as_str());
        if WHAT_IFS.contains(&name.as_str()) {
            assert_eq!(kind, "read", "{name} only asks a question of the board");
        } else if name == "undo_status" {
            assert_eq!(
                kind, "status_read",
                "{name}: the server answers, less what is unsent"
            );
        } else if name == "list_agents" {
            assert_eq!(kind, "remote_read", "{name}: the server alone answers");
        } else {
            assert_eq!(
                writes, predicted,
                "{name} is {kind} but its routes are {verbs}"
            );
        }
    }
}

fn fast() -> Timings {
    Timings {
        ahead_limit: Duration::from_millis(300),
        quiet_before_check: Duration::from_millis(200),
        check_every: Duration::from_secs(600),
        tick: Duration::from_millis(50),
        max_backoff: Duration::from_millis(200),
        settle_wait: Duration::from_millis(500),
    }
}

pub(super) struct Rig {
    pub(super) server: ServerRig,
    pub(super) source: Arc<RigSource>,
    pub(super) replica: Arc<ReplicaBackend>,
    pub(super) published: Arc<Mutex<Vec<u64>>>,
    pub(super) gate: Arc<Gated>,
    pub(super) dropped: Arc<Mutex<Vec<Dropped>>>,
}

impl Rig {
    /// A server and a Replica following it, with the events `drop` names never sent.
    pub(super) async fn start(drop: impl FnOnce(u64) -> Vec<u64>) -> Self {
        Self::start_with(drop, None, false).await
    }

    /// [`Self::start`] with a cache, and with the server's stream refusing to open when `down`.
    pub(super) async fn start_with(
        drop: impl FnOnce(u64) -> Vec<u64>,
        cache: Option<super::cache::SharedCache>,
        down: bool,
    ) -> Self {
        let server = ServerRig::start().await;
        let source = Arc::new(RigSource::new(&server, Duration::from_millis(100)));
        source.drop_events(drop(server.seq()));
        source.down.store(down, Ordering::SeqCst);
        let published = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&published);
        let gate = gated(&server);
        let dropped = Arc::new(Mutex::new(Vec::new()));
        let told = Arc::clone(&dropped);
        let replica = ReplicaBackend::start(ReplicaConfig {
            source: Arc::clone(&source) as _,
            remote: Arc::clone(&gate) as Arc<dyn Backend>,
            sink: Arc::new(move |event: &ChangeEvent| log.lock().expect("lock").push(event.seq)),
            runtime: tokio::runtime::Handle::current(),
            on_dropped: Arc::new(move |notice| told.lock().expect("lock").push(notice)),
            timings: fast(),
            cache,
        })
        .await
        .expect("a replica");
        let rig = Self {
            server,
            source,
            replica,
            published,
            gate,
            dropped,
        };
        if !down {
            rig.local().await;
        }
        rig
    }

    pub(super) async fn local(&self) -> Arc<SqliteBackend> {
        self.replica.local().await.expect("the first board")
    }

    pub(super) async fn replica_rows(&self) -> Vec<StoredRow> {
        let local = self.local().await;
        let mut db = local.factory().begin_read().await.expect("a read");
        arlesh_core::replication::snapshot(&mut db)
            .await
            .expect("rows")
            .rows
    }

    /// Waits until the Replica holds the server's rows, and answers how long it took.
    pub(super) async fn converge(&self) -> Duration {
        let start = Instant::now();
        loop {
            let (theirs, ours) = (self.server.rows().await, self.replica_rows().await);
            if theirs == ours {
                return start.elapsed();
            }
            assert!(
                start.elapsed() < Duration::from_secs(90),
                "the Replica never converged: {} server rows, {} held",
                theirs.len(),
                ours.len()
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

pub(super) fn task(title: &str, parent_type: &str, parent: NodeId) -> CreateTaskRequest {
    CreateTaskRequest {
        title: title.into(),
        parent_type: parent_type.into(),
        parent_id: parent,
        ..Default::default()
    }
}

/// The server's own writes, one publication each, as another client would make them. Answers the
/// sequence number of each publication.
pub(super) async fn session(server: &ServerRig) -> Vec<u64> {
    let bracketed = Arc::clone(&server.bracketed);
    let aspect = {
        let mut db = server.backend.factory().connect().await.expect("a session");
        db.domains()
            .list(Some(DomainSubtype::Aspect))
            .await
            .expect("aspects")[0]
            .id
    };
    let mut seqs = Vec::new();
    let mut seq = server.seq();
    macro_rules! step {
        ($call:expr) => {{
            let answer = $call.await.expect("the write");
            seq = server.published_after(seq).await;
            seqs.push(seq);
            answer
        }};
    }
    let project: NodeId = step!(bracketed.create_domain(CreateDomainRequest {
        id: None,
        title: "Sync".into(),
        description: None,
        subtype: DomainSubtype::Project,
        parent_id: Some(aspect),
        status: None,
        knowledge_base_directory: None,
    }))
    .id
    .into();
    let first = step!(bracketed.create_task(task("First", "project", project.clone()))).id;
    let second = step!(bracketed.create_task(task("Second", "project", project.clone()))).id;
    let child = step!(bracketed.create_task(task("Child", "task", first.clone()))).id;
    step!(bracketed.update_task(
        child.clone(),
        UpdateTaskRequest {
            parent_type: Some("task".into()),
            parent_id: Some(second.clone()),
            position: Some(0),
            ..Default::default()
        },
        None
    ));
    step!(bracketed.update_task(
        second.clone(),
        UpdateTaskRequest {
            title: Some("Second, renamed".into()),
            ..Default::default()
        },
        None
    ));
    step!(bracketed.delete_task(first));
    seqs
}

#[tokio::test]
async fn a_replica_ends_with_the_servers_rows_and_publishes_for_each_event() {
    let rig = Rig::start(|_| Vec::new()).await;
    let before = rig.published.lock().expect("lock").len();

    let seqs = session(&rig.server).await;
    rig.converge().await;

    assert_eq!(seqs.len(), 7);
    assert!(
        rig.published.lock().expect("lock").len() > before,
        "its windows heard of it"
    );
    assert_eq!(
        rig.source.told.snapshots.load(Ordering::SeqCst),
        1,
        "no repair was needed"
    );
}

#[tokio::test]
async fn dropping_any_server_event_is_detected_and_repaired() {
    let events = session(&ServerRig::start().await).await.len() as u64;
    for removed in 0..events {
        let rig = Rig::start(|first| vec![first + 1 + removed]).await;

        session(&rig.server).await;
        rig.converge().await;

        assert_eq!(
            rig.replica_rows().await,
            rig.server.rows().await,
            "dropping event {removed} left the Replica different"
        );
        assert!(
            rig.source.told.dropped.load(Ordering::SeqCst) >= 1,
            "event {removed} was really dropped"
        );
        assert!(
            rig.source.told.snapshots.load(Ordering::SeqCst) >= 2,
            "dropping event {removed} was repaired with a whole board"
        );
    }
}

#[tokio::test]
async fn a_row_changed_behind_the_feed_is_caught_by_the_checksum() {
    let rig = Rig::start(|_| Vec::new()).await;
    session(&rig.server).await;
    rig.converge().await;
    let snapshots = rig.source.told.snapshots.load(Ordering::SeqCst);

    // The capture is lost, then the database changes: no log entry says so.
    rig.server
        .sql("UPDATE change_capture SET leased_until = 0")
        .await;
    rig.server
        .sql("UPDATE tasks SET title = 'Edited behind the feed' WHERE title = 'Child'")
        .await;
    rig.server.backend.record_write();
    rig.converge().await;

    assert!(
        rig.source.told.snapshots.load(Ordering::SeqCst) > snapshots,
        "a snapshot repaired it"
    );
}

#[tokio::test]
async fn a_row_changed_behind_the_feed_is_caught_when_the_event_that_said_so_is_lost() {
    let rig = Rig::start(|_| Vec::new()).await;
    session(&rig.server).await;
    rig.converge().await;
    let snapshots = rig.source.told.snapshots.load(Ordering::SeqCst);
    // With the capture still held, the log is emptied under the publisher: its next turn finds a
    // row no entry accounts for, and the events it sends say nothing of rows. Lose them all.
    let next = rig.server.seq() + 1;
    rig.source.drop_events(next..next + 3);
    rig.server
        .sql(
            "INSERT INTO retired_beads_ids (table_name, row_id, beads_id) VALUES ('tasks', 1, 'x')",
        )
        .await;
    rig.server.sql("DELETE FROM change_log").await;
    rig.server.ticks.notify_one();
    rig.server.published_after(next - 1).await;
    // Only the head can say anything now.
    rig.source.break_streams();

    rig.converge().await;

    assert!(rig.source.told.snapshots.load(Ordering::SeqCst) > snapshots);
}

#[tokio::test]
async fn a_new_epoch_refetches() {
    let rig = Rig::start(|_| Vec::new()).await;
    session(&rig.server).await;
    rig.converge().await;
    let snapshots = rig.source.told.snapshots.load(Ordering::SeqCst);

    // The server restarts: the same database under a new run (a new epoch and publisher).
    let restarted = Arc::new(SqliteBackend::with_rows(
        rig.server.backend.factory().clone(),
        arlesh_core::undo::stacks::UndoStacks::new(),
        Arc::new(super::rig::Ticker(Arc::clone(&rig.server.ticks))),
        Arc::new(|_| {}),
        &tokio::runtime::Handle::current(),
    ));
    restarted.publisher().current().await;
    rig.source.restart_server(Arc::clone(&restarted));
    restarted
        .create_task(task(
            "After the restart",
            "project",
            NodeId::from(first_project(&rig).await),
        ))
        .await
        .expect("a write");
    restarted.record_write();

    rig.converge().await;
    assert!(rig.source.told.snapshots.load(Ordering::SeqCst) > snapshots);
}

pub(super) async fn first_project(rig: &Rig) -> arlesh_core::nodes::id::RowId {
    let mut db = rig
        .server
        .backend
        .factory()
        .connect()
        .await
        .expect("a session");
    db.domains()
        .list(Some(DomainSubtype::Project))
        .await
        .expect("projects")[0]
        .id
}

#[tokio::test]
async fn a_schema_mismatch_is_read_only_and_names_the_side() {
    for (skew, reason) in [
        (1, ReadOnlyReason::UpdateApp),
        (-1, ReadOnlyReason::UpdateServer),
    ] {
        let server = ServerRig::start().await;
        let source = Arc::new(RigSource::new(&server, Duration::from_millis(100)));
        source.schema_skew.store(skew, Ordering::SeqCst);
        let _replica = ReplicaBackend::start(ReplicaConfig {
            source: Arc::clone(&source) as _,
            remote: remote(&server),
            sink: Arc::new(|_| {}),
            runtime: tokio::runtime::Handle::current(),
            on_dropped: Arc::new(|_| {}),
            timings: fast(),
            cache: None,
        })
        .await
        .expect("a replica");

        let start = Instant::now();
        while !source
            .told
            .holds
            .lock()
            .expect("lock")
            .contains(&Some(reason))
        {
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "no {reason:?} hold"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(
            source
                .told
                .holds
                .lock()
                .expect("lock")
                .iter()
                .all(|hold| hold.is_some()),
            "a board of another schema was never let through"
        );
    }
}

#[test]
fn the_kinds_list_has_each_kind_the_macros_know() {
    let names: BTreeSet<String> = kinds().into_iter().map(|(_, kind)| kind).collect();
    assert_eq!(
        names.into_iter().collect::<Vec<_>>(),
        [
            "create",
            "local",
            "option_read",
            "read",
            "refused",
            "remote",
            "remote_read",
            "status_read",
            "undo",
            "write"
        ]
    );
}

#[allow(dead_code)]
fn _backend_is_object_safe(replica: Arc<ReplicaBackend>) -> Arc<dyn Backend> {
    replica
}

/// A cache in memory.
#[derive(Default)]
struct MemoryCache(Mutex<Option<String>>);

impl super::cache::CacheStore for MemoryCache {
    fn load(&self) -> Option<String> {
        self.0.lock().expect("lock").clone()
    }

    fn store(&self, body: &str) -> std::io::Result<()> {
        *self.0.lock().expect("lock") = Some(body.to_owned());
        Ok(())
    }
}

#[tokio::test]
async fn the_first_board_of_a_run_is_cached_and_the_confirmed_board_is_what_quitting_keeps() {
    let cache = Arc::new(MemoryCache::default());
    let rig = Rig::start_with(|_| Vec::new(), Some(Arc::clone(&cache) as _), false).await;
    session(&rig.server).await;
    rig.converge().await;
    assert!(cache.load().is_some(), "the startup fetch was written");

    // A write the server has not answered must not be kept as if it were the board.
    rig.gate.hold();
    rig.replica
        .create_task(task(
            "Unconfirmed",
            "project",
            first_project(&rig).await.into(),
        ))
        .await
        .expect("shown at once");
    let kept = rig.replica.confirmed_board().await.expect("a board");

    assert!(
        !kept.contains("Unconfirmed"),
        "predictions are taken back before writing"
    );
    assert!(
        kept.contains("Second, renamed"),
        "what the server confirmed is kept"
    );
}

#[tokio::test]
async fn the_cached_board_is_shown_read_only_before_the_server_answers() {
    let first = Rig::start_with(
        |_| Vec::new(),
        Some(Arc::new(MemoryCache::default()) as _),
        false,
    )
    .await;
    session(&first.server).await;
    first.converge().await;
    let kept = first.replica.confirmed_board().await.expect("a board");
    let cache = Arc::new(MemoryCache::default());
    super::cache::CacheStore::store(&*cache, &kept).expect("stored");

    // A new run, the server not answering: the cached board is there, and writes are refused.
    let rig = Rig::start_with(|_| Vec::new(), Some(cache as _), true).await;
    let local = rig.replica.local().await.expect("the cached board");
    let tasks = local
        .list_tasks(arlesh_core::clock::now())
        .await
        .expect("tasks");

    assert!(tasks.iter().any(|task| task.title == "Second, renamed"));
    let refused = rig
        .replica
        .create_task(task(
            "Not yet",
            "project",
            NodeId::from(arlesh_core::nodes::new_id::new_row_id()),
        ))
        .await
        .expect_err("read-only");
    assert_eq!(
        refused.details().and_then(|details| details.get("reason")),
        Some(&serde_json::json!(ReadOnlyReason::Syncing))
    );
}
