//! Scripted sessions against a real server database with a publisher, and a Replica kept in step
//! from nothing but its snapshot and the events: what ADR 0017 asks of the sync surface.
//!
//! The Replica here is a plain second database. It applies each event's rows as a client would
//! (delete or `INSERT OR REPLACE` by `rowid`, foreign keys off), and after every event its hash must
//! be the one the event states.

use std::{
    str::FromStr,
    sync::{atomic::AtomicU32, atomic::Ordering, Arc},
    time::Duration,
};

use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use tokio::sync::Notify;

use super::*;
use crate::{
    database::{
        open::{open, OpenMode},
        session::{Db, SessionFactory, Transactional},
    },
    domains::model::{CreateDomainRequest, DomainSubtype},
    mcp::events::ChangeFeed,
    mindmap::publisher::{BoardPublisher, Clock, Sink, Tick},
    nodes::id::{NodeId, RowId},
    tasks::{
        answer_drafts::model::{DraftRequest, SendRequest},
        model::{
            CreateExpectationRequest, CreateTaskRequest, TaskAgentic, TaskArchival, TaskId,
            UpdateTaskRequest,
        },
    },
    undo::{self, stacks::UndoStacks},
};

static NEXT_DIRECTORY: AtomicU32 = AtomicU32::new(0);

/// A clock that ticks only when the test says so.
struct Ticker(Arc<Notify>);

impl Clock for Ticker {
    fn now(&self) -> chrono::NaiveDateTime {
        crate::clock::now()
    }

    fn next_tick(&self) -> Tick {
        let notify = Arc::clone(&self.0);
        Box::pin(async move { notify.notified().await })
    }
}

/// A Replica: a second database and a change-log position.
struct Replica {
    pool: SqlitePool,
    position: i64,
}

/// Why a Replica must fetch a snapshot.
#[derive(Debug, PartialEq, Eq)]
enum Gap {
    /// The event's `base` is past where the Replica is: an event was missed.
    Missed,
    /// The event carries no `source`: the publisher says rows cannot be applied.
    NoSource,
}

impl Replica {
    async fn empty() -> Self {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(false);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        crate::database::run_migrations(&pool).await.unwrap();
        Self { pool, position: 0 }
    }

    async fn put(&self, table: &str, rowid: i64, image: &Value) {
        let object = image.as_object().unwrap();
        let names: Vec<String> = object.keys().map(|key| format!("\"{key}\"")).collect();
        let values: Vec<String> = object
            .keys()
            .map(|key| format!("json_extract(?1, '$.\"{key}\"')"))
            .collect();
        let sql = format!(
            "INSERT OR REPLACE INTO \"{table}\" (rowid, {}) VALUES (?2, {})",
            names.join(", "),
            values.join(", ")
        );
        sqlx::query(&sql)
            .bind(image.to_string())
            .bind(rowid)
            .execute(&self.pool)
            .await
            .unwrap();
    }

    /// Replaces every replicated row with the snapshot's.
    async fn load(&mut self, body: &Value) {
        let factory = SessionFactory::new(self.pool.clone());
        let mut db = factory.begin_read().await.unwrap();
        let held = db.replication().tables().await.unwrap();
        drop(db);
        for table in held {
            sqlx::query(&format!("DELETE FROM \"{table}\""))
                .execute(&self.pool)
                .await
                .unwrap();
        }
        for (table, rows) in body["tables"].as_object().unwrap() {
            for row in rows.as_array().unwrap() {
                self.put(table, row["rowid"].as_i64().unwrap(), &row["image"])
                    .await;
            }
        }
        self.position = body["source"]["upto"].as_i64().unwrap();
    }

    /// Applies one live event as a client would, or says it must fetch a snapshot. Checks the hash.
    async fn apply(&mut self, event: &Value) -> Result<(), Gap> {
        let source = &event["source"];
        if source.is_null() {
            return Err(Gap::NoSource);
        }
        let (base, upto) = (
            source["base"].as_i64().unwrap(),
            source["upto"].as_i64().unwrap(),
        );
        if upto <= self.position {
            return Ok(());
        }
        if base > self.position {
            return Err(Gap::Missed);
        }
        for row in source["rows"].as_array().unwrap() {
            if row["seq"].as_i64().unwrap() <= self.position {
                continue;
            }
            let (table, rowid) = (
                row["table"].as_str().unwrap(),
                row["rowid"].as_i64().unwrap(),
            );
            match row["op"].as_str().unwrap() {
                "set" => self.put(table, rowid, &row["image"]).await,
                _ => {
                    sqlx::query(&format!("DELETE FROM \"{table}\" WHERE rowid = ?"))
                        .bind(rowid)
                        .execute(&self.pool)
                        .await
                        .unwrap();
                }
            }
        }
        self.position = upto;
        assert_eq!(
            self.hash().await,
            source["hash"].as_str().unwrap(),
            "the Replica's rows must hash as the server said after event {}",
            event["seq"]
        );
        Ok(())
    }

    async fn rows(&self) -> Vec<StoredRow> {
        let factory = SessionFactory::new(self.pool.clone());
        let mut db = factory.begin_read().await.unwrap();
        snapshot(&mut db).await.unwrap().rows
    }

    async fn hash(&self) -> String {
        rules::hash::board_hash(&self.rows().await)
    }
}

struct Server {
    factory: SessionFactory,
    stacks: UndoStacks,
    publisher: BoardPublisher,
    ticks: Arc<Notify>,
    /// The last event's `seq` taken from the publisher.
    seen: u64,
}

impl Server {
    async fn start() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "arlesh-replication-test-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let factory = open(
            &directory.join("arlesh.db"),
            OpenMode::Write {
                client: "test".parse().unwrap(),
                force: false,
            },
        )
        .await
        .unwrap();
        let ticks = Arc::new(Notify::new());
        let publisher = Self::publisher(&factory, &ticks, true);
        // The first publication is the seed: wait for it, so the capture is held.
        publisher.current().await;
        Self {
            factory,
            stacks: UndoStacks::new(),
            publisher,
            ticks,
            seen: 1,
        }
    }

    /// Another publisher over the same file, with or without rows.
    fn publisher(factory: &SessionFactory, ticks: &Arc<Notify>, rows: bool) -> BoardPublisher {
        let sink: Sink = Arc::new(|_| {});
        let start = if rows {
            BoardPublisher::start_with_rows
        } else {
            BoardPublisher::start
        };
        start(
            factory.clone(),
            ChangeFeed::new(),
            Arc::new(Ticker(Arc::clone(ticks))),
            sink,
            &tokio::runtime::Handle::current(),
        )
    }

    fn pool(&self) -> SqlitePool {
        self.factory.pool_for_tests().clone()
    }

    async fn snapshot_body(&self) -> Value {
        let mut db = self.factory.begin_read().await.unwrap();
        let snapshot = snapshot(&mut db).await.unwrap();
        serde_json::from_str(&rules::wire::snapshot_body(&snapshot, "e", 0).unwrap()).unwrap()
    }

    /// One user Gesture: opened, written, committed and closed onto the undo stack. Not announced.
    async fn commit<T>(&mut self, write: impl AsyncFnOnce(&mut Db<Transactional>) -> T) -> T {
        let mut db = self.factory.begin().await.unwrap();
        db.undo().open_gesture().await.unwrap();
        let outcome = write(&mut db).await;
        db.commit().await.unwrap();
        undo::close_gesture(&self.factory, &self.stacks)
            .await
            .unwrap();
        outcome
    }

    /// One user Gesture, then announced.
    async fn gesture<T>(
        &mut self,
        write: impl AsyncFnOnce(&mut Db<Transactional>) -> T,
    ) -> (T, Vec<Value>) {
        let outcome = self.commit(write).await;
        (outcome, self.announce().await)
    }

    /// The events the publisher makes next, as a Replica's stream sends them (rows included).
    async fn next_events(&mut self) -> Vec<Value> {
        let events = self
            .publisher
            .after(self.seen, Duration::from_secs(10))
            .await;
        assert!(!events.is_empty(), "the publisher must publish");
        self.seen = events.last().unwrap().seq;
        events
            .iter()
            .map(|event| serde_json::from_str(&event.wire(true)).unwrap())
            .collect()
    }

    async fn announce(&mut self) -> Vec<Value> {
        self.publisher.record_write();
        self.next_events().await
    }

    /// A tick of the publisher's clock: no write is announced.
    async fn tick(&mut self) -> Vec<Value> {
        self.ticks.notify_one();
        self.next_events().await
    }

    async fn rows(&self) -> Vec<StoredRow> {
        let mut db = self.factory.begin_read().await.unwrap();
        snapshot(&mut db).await.unwrap().rows
    }

    async fn truth(&self) -> String {
        rules::hash::board_hash(&self.rows().await)
    }
}

fn task(title: &str, parent_type: &str, parent: NodeId) -> CreateTaskRequest {
    CreateTaskRequest {
        title: title.into(),
        parent_type: parent_type.into(),
        parent_id: parent,
        ..Default::default()
    }
}

fn task_id(id: &NodeId) -> TaskId {
    TaskId(id.require_stored().unwrap())
}

async fn sql(pool: &SqlitePool, statement: &str) {
    sqlx::query(statement).execute(pool).await.unwrap();
}

/// The scripted session: every event it makes, in order.
async fn run_session(server: &mut Server) -> Vec<Value> {
    let mut events = Vec::new();

    let aspect: RowId = {
        let mut db = server.factory.connect().await.unwrap();
        db.domains()
            .list(Some(DomainSubtype::Aspect))
            .await
            .unwrap()[0]
            .id
    };
    let (project, more) = server
        .gesture(async |db| {
            db.domains()
                .create(CreateDomainRequest {
                    id: None,
                    title: "Sync".into(),
                    description: None,
                    subtype: DomainSubtype::Project,
                    parent_id: Some(aspect),
                    status: None,
                    knowledge_base_directory: None,
                })
                .await
                .unwrap()
                .id
        })
        .await;
    events.extend(more);
    let project: NodeId = project.into();

    // Creates.
    let ((_first, second, child), more) = server
        .gesture(async |db| {
            let first = crate::tasks::create_task(db, task("First", "project", project.clone()))
                .await
                .unwrap()
                .id;
            let second = crate::tasks::create_task(db, task("Second", "project", project.clone()))
                .await
                .unwrap()
                .id;
            let child = crate::tasks::create_task(db, task("Child", "task", first.clone()))
                .await
                .unwrap()
                .id;
            crate::tasks::create_task(db, task("Grandchild", "task", child.clone()))
                .await
                .unwrap();
            (first, second, child)
        })
        .await;
    events.extend(more);

    // A move.
    let (_, more) = server
        .gesture(async |db| {
            crate::tasks::update_task(
                db,
                task_id(&child),
                UpdateTaskRequest {
                    parent_type: Some("task".into()),
                    parent_id: Some(second.clone()),
                    position: Some(0),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        })
        .await;
    events.extend(more);

    // An archive.
    let (_, more) = server
        .gesture(async |db| {
            crate::tasks::update_task(
                db,
                task_id(&second),
                UpdateTaskRequest {
                    archival: Some(TaskArchival::Backlog),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        })
        .await;
    events.extend(more);

    // A delete with a cascade: the Task, the subtree beneath it.
    let (_, more) = server
        .gesture(async |db| {
            crate::tasks::delete_task(db, task_id(&second))
                .await
                .unwrap();
        })
        .await;
    events.extend(more);

    // Undo and redo of that delete.
    undo::undo(&server.factory, &server.stacks)
        .await
        .unwrap()
        .unwrap();
    events.extend(server.announce().await);
    undo::redo(&server.factory, &server.stacks)
        .await
        .unwrap()
        .unwrap();
    events.extend(server.announce().await);
    undo::undo(&server.factory, &server.stacks)
        .await
        .unwrap()
        .unwrap();
    events.extend(server.announce().await);

    // A staged answer, then the batch sent.
    let ((wait, _), more) = server
        .gesture(async |db| {
            let agentic = crate::tasks::create_task(
                db,
                CreateTaskRequest {
                    agentic: Some(TaskAgentic::Yes),
                    ..task("Agent work", "project", project.clone())
                },
            )
            .await
            .unwrap()
            .id;
            let wait = crate::tasks::create_expectation(
                db,
                CreateExpectationRequest {
                    title: "Which one?".into(),
                    parent_type: "task".into(),
                    parent_id: agentic.clone(),
                    agentic: true,
                    agentic_note: Some("Pick".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap()
            .id;
            (wait, agentic)
        })
        .await;
    events.extend(more);
    let (_, more) = server
        .gesture(async |db| {
            crate::tasks::answer_drafts::save_draft(
                db,
                &wait,
                DraftRequest {
                    answer: Some("The second".into()),
                    verdict: None,
                },
                crate::clock::now(),
            )
            .await
            .unwrap();
        })
        .await;
    events.extend(more);
    let (_, more) = server
        .gesture(async |db| {
            crate::tasks::answer_drafts::send_drafts(
                db,
                SendRequest {
                    shown: vec![wait.clone()],
                },
                crate::clock::now(),
            )
            .await
            .unwrap();
        })
        .await;
    events.extend(more);

    // Agents: a parent and a child (the credential column is `NOT NULL UNIQUE`, so a device's row
    // must apply under the same schema), a Claim, a lock, then bookkeeping that changes nothing a
    // device holds.
    let pool = server.pool();
    sql(&pool, "INSERT INTO agents (id, name, account, session_uuid, token_sha256, created_at) VALUES (1, 'parent', 'default', 's1', 'SECRET-1', 'x')").await;
    sql(&pool, "INSERT INTO agents (id, name, account, session_uuid, token_sha256, created_at, parent_id) VALUES (2, 'child', 'default', 's2', 'SECRET-2', 'x', 1)").await;
    events.extend(server.announce().await);
    sql(&pool, "UPDATE agents SET locked = 1 WHERE id = 2").await;
    events.extend(server.announce().await);
    sql(&pool, "DELETE FROM agents WHERE id = 2").await;
    events.extend(server.announce().await);

    events
}

#[tokio::test]
async fn a_replica_fed_the_events_ends_with_the_servers_rows_byte_for_byte() {
    let mut server = Server::start().await;
    let mut replica = Replica::empty().await;
    replica.load(&server.snapshot_body().await).await;
    assert_eq!(
        replica.rows().await,
        server.rows().await,
        "the snapshot loads whole"
    );

    let events = run_session(&mut server).await;
    for event in &events {
        replica.apply(event).await.unwrap();
    }

    assert!(events.len() >= 12, "each step published: {}", events.len());
    assert_eq!(replica.rows().await, server.rows().await);
    let head = server.publisher.head().unwrap().source.unwrap();
    assert_eq!(head.hash, replica.hash().await);
    assert_eq!(head.upto, replica.position);
    let text: String = server
        .rows()
        .await
        .iter()
        .map(|row| row.image.clone())
        .collect();
    assert!(!text.contains("SECRET-"), "no credential travels");
}

#[tokio::test]
async fn the_session_changed_cascaded_and_undone_rows_are_all_reported() {
    let mut server = Server::start().await;
    let events = run_session(&mut server).await;

    let reported = |table: &str, op: &str| {
        events
            .iter()
            .flat_map(|event| event["source"]["rows"].as_array().unwrap())
            .filter(|row| row["table"] == table && row["op"] == op)
            .count()
    };
    assert!(reported("tasks", "set") >= 5, "creates and edits");
    assert!(
        reported("tasks", "del") >= 3,
        "the delete cascaded to the subtree"
    );
    assert!(reported("answer_drafts", "set") >= 1, "the staged answer");
    assert!(
        reported("answer_drafts", "del") >= 1,
        "the batch consumed it"
    );
    assert!(
        reported("expectations", "set") >= 2,
        "the wait, and its release"
    );
    assert!(
        reported("agents", "set") >= 3,
        "a parent, a child and a lock"
    );
    assert!(reported("agents", "del") >= 1, "the child went");
}

#[tokio::test]
async fn removing_any_event_that_carried_rows_is_detected_from_the_positions_alone() {
    let mut server = Server::start().await;
    let snapshot = server.snapshot_body().await;
    let events = run_session(&mut server).await;
    let head = server.publisher.head().unwrap().source.unwrap();
    let moved = |event: &Value| event["source"]["base"] != event["source"]["upto"];

    for removed in (0..events.len()).filter(|&index| moved(&events[index])) {
        let mut replica = Replica::empty().await;
        replica.load(&snapshot).await;
        let mut missed = false;
        for (index, event) in events.iter().enumerate() {
            if index == removed {
                continue;
            }
            if replica.apply(event).await == Err(Gap::Missed) {
                missed = true;
                break;
            }
        }
        // The last such event has no successor to show the gap, so the head does.
        missed |= replica.position != head.upto;
        assert!(missed, "removing event {removed} went unnoticed");
    }
}

#[tokio::test]
async fn removing_an_event_that_carried_no_rows_loses_nothing() {
    let mut server = Server::start().await;
    let snapshot = server.snapshot_body().await;
    let mut events = run_session(&mut server).await;
    // A write that changes no replicated row publishes an event whose source is empty.
    server.publisher.record_write();
    events.extend(server.next_events().await);
    let empty = events.len() - 1;
    assert_eq!(
        events[empty]["source"]["base"],
        events[empty]["source"]["upto"]
    );

    let mut replica = Replica::empty().await;
    replica.load(&snapshot).await;
    for event in &events[..empty] {
        replica.apply(event).await.unwrap();
    }

    assert_eq!(replica.rows().await, server.rows().await);
}

#[tokio::test]
async fn the_events_carry_consecutive_sequence_numbers_so_a_removal_also_shows_there() {
    let mut server = Server::start().await;
    let events = run_session(&mut server).await;

    let seqs: Vec<u64> = events
        .iter()
        .map(|event| event["seq"].as_u64().unwrap())
        .collect();
    assert!(
        seqs.windows(2).all(|pair| pair[1] == pair[0] + 1),
        "{seqs:?}"
    );
}

#[tokio::test]
async fn several_transactions_before_one_publication_arrive_as_one_event() {
    let mut server = Server::start().await;
    let mut replica = Replica::empty().await;
    replica.load(&server.snapshot_body().await).await;
    let aspect: RowId = {
        let mut db = server.factory.connect().await.unwrap();
        db.domains()
            .list(Some(DomainSubtype::Aspect))
            .await
            .unwrap()[0]
            .id
    };

    let mut parent = NodeId::from(aspect);
    for title in ["One", "Two", "Three"] {
        let created = server
            .commit(async |db| {
                crate::tasks::create_task(db, task(title, "domain", parent.clone()))
                    .await
                    .unwrap()
                    .id
            })
            .await;
        parent = created;
    }
    let events = server.announce().await;

    assert_eq!(events.len(), 1, "one publication took all three");
    let rows = events[0]["source"]["rows"].as_array().unwrap();
    assert!(rows.iter().filter(|row| row["table"] == "tasks").count() >= 3);
    replica.apply(&events[0]).await.unwrap();
    assert_eq!(replica.rows().await, server.rows().await);
}

#[tokio::test]
async fn a_tick_that_finds_rows_no_write_announced_publishes_them_and_the_late_announcement_is_empty(
) {
    let mut server = Server::start().await;
    let mut replica = Replica::empty().await;
    replica.load(&server.snapshot_body().await).await;
    let aspect: RowId = {
        let mut db = server.factory.connect().await.unwrap();
        db.domains()
            .list(Some(DomainSubtype::Aspect))
            .await
            .unwrap()[0]
            .id
    };

    // A write commits, but the announcement (the revision bump) has not happened yet when the
    // publisher's clock ticks: its rows are drained under the old revision.
    server
        .commit(async |db| {
            crate::tasks::create_task(db, task("Early", "domain", aspect.into()))
                .await
                .unwrap();
        })
        .await;
    let early = server.tick().await;
    let late = server.announce().await;

    assert!(!early[0]["source"]["rows"].as_array().unwrap().is_empty());
    assert!(late[0]["source"]["rows"].as_array().unwrap().is_empty());
    assert!(late[0]["revision"].as_u64() > early[0]["revision"].as_u64());
    for event in early.iter().chain(&late) {
        replica.apply(event).await.unwrap();
    }
    assert_eq!(replica.rows().await, server.rows().await);
}

#[tokio::test]
async fn a_unique_key_that_moves_between_rows_converges_once_the_event_is_applied() {
    let mut server = Server::start().await;
    let pool = server.pool();
    sql(&pool, "INSERT INTO agents (id, name, account, session_uuid, token_sha256, created_at) VALUES (1, 'alpha', 'd', 's', 'T1', 'x')").await;
    sql(&pool, "INSERT INTO agents (id, name, account, session_uuid, token_sha256, created_at) VALUES (2, 'beta', 'd', 's', 'T2', 'x')").await;
    let mut replica = Replica::empty().await;
    server.announce().await;
    replica.load(&server.snapshot_body().await).await;

    // Swap the two names (`agents.name` is UNIQUE): applying one row first conflicts with the other.
    sql(&pool, "UPDATE agents SET name = 'tmp' WHERE id = 1").await;
    sql(&pool, "UPDATE agents SET name = 'alpha' WHERE id = 2").await;
    sql(&pool, "UPDATE agents SET name = 'beta' WHERE id = 1").await;
    for event in server.announce().await {
        replica.apply(&event).await.unwrap();
    }

    assert_eq!(replica.rows().await, server.rows().await);
}

#[tokio::test]
async fn a_row_changed_behind_the_feed_is_caught_by_the_published_hash() {
    let mut server = Server::start().await;
    let mut replica = Replica::empty().await;
    replica.load(&server.snapshot_body().await).await;
    for event in &run_session(&mut server).await {
        replica.apply(event).await.unwrap();
    }
    let agreed = server.publisher.head().unwrap().source.unwrap();
    assert_eq!(agreed.hash, replica.hash().await);

    // The capture is lost (another process took it, or switched it off, or the lease lapsed), and
    // then the database changes: no log entry, so nothing in the feed says so.
    sql(&server.pool(), "UPDATE change_capture SET leased_until = 0").await;
    sql(
        &server.pool(),
        "UPDATE tasks SET title = 'Edited behind the feed' WHERE title = 'First'",
    )
    .await;
    let events = server.announce().await;

    let head = server.publisher.head().unwrap().source.unwrap();
    assert_eq!(
        head.hash,
        server.truth().await,
        "the published head states what the database holds"
    );
    assert_ne!(
        head.hash,
        replica.hash().await,
        "a faithful Replica disagrees with the head"
    );
    for event in &events {
        assert!(
            event.get("source").is_none(),
            "an event that cannot say what changed must not claim to: {event}"
        );
        assert_eq!(replica.apply(event).await, Err(Gap::NoSource));
    }

    // The publisher heals: a snapshot, then the feed agrees again.
    replica.load(&server.snapshot_body().await).await;
    sql(
        &server.pool(),
        "UPDATE tasks SET title = 'Edited again' WHERE title = 'Second'",
    )
    .await;
    for event in server.announce().await {
        replica.apply(&event).await.unwrap();
    }
    assert_eq!(replica.rows().await, server.rows().await);
}

#[tokio::test]
async fn a_row_changed_behind_the_feed_with_the_capture_still_held_is_caught_on_a_tick() {
    let mut server = Server::start().await;
    let mut replica = Replica::empty().await;
    replica.load(&server.snapshot_body().await).await;
    // A writer that bypasses the triggers' notice entirely: the log is emptied under the publisher.
    sql(
        &server.pool(),
        "INSERT INTO retired_beads_ids (table_name, row_id, beads_id) VALUES ('tasks', 1, 'x')",
    )
    .await;
    sql(&server.pool(), "DELETE FROM change_log").await;

    let events = server.tick().await;

    let head = server.publisher.head().unwrap().source.unwrap();
    assert_eq!(head.hash, server.truth().await);
    assert_ne!(head.hash, replica.hash().await);
    assert!(events.iter().all(|event| event.get("source").is_none()));
}

#[tokio::test]
async fn a_publisher_without_rows_on_the_same_file_does_not_take_the_capture() {
    let mut server = Server::start().await;
    let mut replica = Replica::empty().await;
    replica.load(&server.snapshot_body().await).await;

    // The desktop's Standalone publisher opened on the file while the server runs.
    let desktop = Server::publisher(&server.factory, &server.ticks, false);
    desktop.current().await;
    let aspect: RowId = {
        let mut db = server.factory.connect().await.unwrap();
        db.domains()
            .list(Some(DomainSubtype::Aspect))
            .await
            .unwrap()[0]
            .id
    };
    server
        .commit(async |db| {
            crate::tasks::create_task(db, task("After", "domain", aspect.into()))
                .await
                .unwrap();
        })
        .await;
    for event in server.announce().await {
        replica.apply(&event).await.unwrap();
    }

    assert_eq!(replica.rows().await, server.rows().await);
    assert_eq!(
        server.publisher.head().unwrap().source.unwrap().hash,
        server.truth().await
    );
}

#[tokio::test]
async fn a_second_publisher_with_rows_is_refused_and_the_first_goes_on() {
    let mut server = Server::start().await;
    let mut replica = Replica::empty().await;
    replica.load(&server.snapshot_body().await).await;

    let second = Server::publisher(&server.factory, &server.ticks, true);
    second.current().await;
    let aspect: RowId = {
        let mut db = server.factory.connect().await.unwrap();
        db.domains()
            .list(Some(DomainSubtype::Aspect))
            .await
            .unwrap()[0]
            .id
    };
    server
        .commit(async |db| {
            crate::tasks::create_task(db, task("After", "domain", aspect.into()))
                .await
                .unwrap();
        })
        .await;
    for event in server.announce().await {
        replica.apply(&event).await.unwrap();
    }

    assert!(
        second.head().unwrap().source.is_none(),
        "it holds no capture, so it publishes no rows"
    );
    assert_eq!(replica.rows().await, server.rows().await);
}

#[tokio::test]
async fn giving_up_the_capture_stops_the_log_and_the_publisher_does_not_take_it_again() {
    let mut server = Server::start().await;
    server.publisher.release_capture(&server.factory).await;

    let aspect: RowId = {
        let mut db = server.factory.connect().await.unwrap();
        db.domains()
            .list(Some(DomainSubtype::Aspect))
            .await
            .unwrap()[0]
            .id
    };
    server
        .commit(async |db| {
            crate::tasks::create_task(db, task("After", "domain", aspect.into()))
                .await
                .unwrap();
        })
        .await;
    server.publisher.record_write();
    server.next_events().await;
    let logged: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(&server.pool())
        .await
        .unwrap();
    let leased: i64 = sqlx::query_scalar("SELECT leased_until FROM change_capture")
        .fetch_one(&server.pool())
        .await
        .unwrap();

    assert_eq!((logged, leased), (0, 0));
}
