//! A scripted session against a real server database with a publisher, and a Replica kept in step
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

/// A clock that never ticks, so only writes publish.
struct NeverTicks;

impl Clock for NeverTicks {
    fn now(&self) -> chrono::NaiveDateTime {
        crate::clock::now()
    }

    fn next_tick(&self) -> Tick {
        Box::pin(std::future::pending())
    }
}

/// A Replica: a second database, a change-log position, and the hash it last agreed on.
struct Replica {
    pool: SqlitePool,
    position: i64,
}

/// Why a Replica must fetch a snapshot.
#[derive(Debug, PartialEq, Eq)]
enum Gap {
    /// The event's `base` is past where the Replica is: an event was missed.
    Missed,
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

    /// Applies one live event as a client would, or says it missed one. Checks the hash.
    async fn apply(&mut self, event: &Value) -> Result<(), Gap> {
        let source = &event["source"];
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
        let sink: Sink = Arc::new(|_| {});
        let publisher = BoardPublisher::start_with_rows(
            factory.clone(),
            ChangeFeed::new(),
            Arc::new(NeverTicks),
            sink,
            &tokio::runtime::Handle::current(),
        );
        // The first publication is the seed: wait for it, so the log is capturing.
        publisher.current().await;
        Self {
            factory,
            stacks: UndoStacks::new(),
            publisher,
            seen: 1,
        }
    }

    async fn snapshot_body(&self) -> Value {
        let mut db = self.factory.begin_read().await.unwrap();
        let snapshot = snapshot(&mut db).await.unwrap();
        serde_json::from_str(&rules::wire::snapshot_body(&snapshot, "e", 0).unwrap()).unwrap()
    }

    /// One user Gesture: opened, written, committed and closed onto the undo stack, then announced.
    async fn gesture<T>(
        &mut self,
        write: impl AsyncFnOnce(&mut Db<Transactional>) -> T,
    ) -> (T, Vec<Value>) {
        let mut db = self.factory.begin().await.unwrap();
        db.undo().open_gesture().await.unwrap();
        let outcome = write(&mut db).await;
        db.commit().await.unwrap();
        undo::close_gesture(&self.factory, &self.stacks)
            .await
            .unwrap();
        (outcome, self.announce().await)
    }

    async fn announce(&mut self) -> Vec<Value> {
        self.publisher.record_write();
        let events = self
            .publisher
            .after(self.seen, Duration::from_secs(10))
            .await;
        assert!(!events.is_empty(), "a write must publish");
        self.seen = events.last().unwrap().seq;
        events
            .iter()
            .map(|event| serde_json::from_str(&event.data).unwrap())
            .collect()
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

/// The scripted session: every event it makes, in order, and the server's rows at the end.
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

    events
}

async fn server_rows(server: &Server) -> Vec<StoredRow> {
    let mut db = server.factory.begin_read().await.unwrap();
    snapshot(&mut db).await.unwrap().rows
}

#[tokio::test]
async fn a_replica_fed_the_events_ends_with_the_servers_rows_byte_for_byte() {
    let mut server = Server::start().await;
    let mut replica = Replica::empty().await;
    replica.load(&server.snapshot_body().await).await;
    assert_eq!(
        replica.rows().await,
        server_rows(&server).await,
        "the snapshot loads whole"
    );

    let events = run_session(&mut server).await;
    for event in &events {
        replica.apply(event).await.unwrap();
    }

    assert!(events.len() >= 9, "each step published: {}", events.len());
    assert_eq!(replica.rows().await, server_rows(&server).await);
    let head = server.publisher.head().unwrap().source.unwrap();
    assert_eq!(head.hash, replica.hash().await);
    assert_eq!(head.upto, replica.position);
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
}

#[tokio::test]
async fn removing_any_event_is_detected_from_the_positions_alone() {
    let mut server = Server::start().await;
    let snapshot = server.snapshot_body().await;
    let events = run_session(&mut server).await;
    let head = server.publisher.head().unwrap().source.unwrap();

    for removed in 0..events.len() {
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
        // The last event has no successor to show the gap, so the head does.
        missed |= replica.position != head.upto;
        assert!(missed, "removing event {removed} went unnoticed");
    }
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
async fn a_row_changed_behind_the_feed_is_caught_by_the_hash() {
    let mut server = Server::start().await;
    let mut replica = Replica::empty().await;
    replica.load(&server.snapshot_body().await).await;
    let events = run_session(&mut server).await;
    for event in &events {
        replica.apply(event).await.unwrap();
    }
    let agreed = server.publisher.head().unwrap().source.unwrap();
    assert_eq!(agreed.hash, replica.hash().await);

    // A writer that is not the server's board publisher: a second process, a script with `force`.
    // Switch the capture off the way such a process's rows are never captured, then edit.
    sqlx::query("UPDATE change_capture SET enabled = 0")
        .execute(&sqlx_pool(&server))
        .await
        .unwrap();
    sqlx::query("UPDATE tasks SET title = 'Edited behind the feed' WHERE title = 'First'")
        .execute(&sqlx_pool(&server))
        .await
        .unwrap();

    let mut db = server.factory.begin_read().await.unwrap();
    let server_now = snapshot(&mut db).await.unwrap();
    assert_eq!(server_now.upto, agreed.upto, "no event announced it");
    assert_ne!(server_now.hash, replica.hash().await, "the hash sees it");
}

fn sqlx_pool(server: &Server) -> SqlitePool {
    server.factory.pool_for_tests().clone()
}
