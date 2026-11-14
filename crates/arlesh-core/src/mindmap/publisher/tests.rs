//! The publisher, over an in-memory database and a clock the test moves.

use std::sync::Arc;

use chrono::NaiveDate;
use serde_json::Value;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use tokio::sync::Notify;

use super::*;

struct TestClock {
    now: Mutex<NaiveDateTime>,
    ticks: Arc<Notify>,
}

impl TestClock {
    fn at(day: u32, hour: u32) -> Arc<Self> {
        Arc::new(Self {
            now: Mutex::new(moment(day, hour)),
            ticks: Arc::new(Notify::new()),
        })
    }

    /// Moves the clock and fires a tick.
    fn tick_at(&self, day: u32, hour: u32) {
        *lock(&self.now) = moment(day, hour);
        self.ticks.notify_one();
    }
}

impl Clock for TestClock {
    fn now(&self) -> NaiveDateTime {
        *lock(&self.now)
    }

    fn next_tick(&self) -> Tick {
        let ticks = Arc::clone(&self.ticks);
        Box::pin(async move { ticks.notified().await })
    }
}

fn moment(day: u32, hour: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 11, day)
        .and_then(|date| date.and_hms_opt(hour, 0, 0))
        .unwrap()
}

struct Rig {
    pool: SqlitePool,
    factory: SessionFactory,
    publisher: BoardPublisher,
    clock: Arc<TestClock>,
    heard: Arc<Mutex<Vec<ChangeEvent>>>,
}

async fn rig(clock: Arc<TestClock>, seed: &[&str]) -> Rig {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::database::run_migrations(&pool).await.unwrap();
    for sql in [
        "INSERT INTO domains (id, title, subtype) VALUES (901, 'Growth', 'aspect')",
        "INSERT INTO domains (id, title, subtype, parent_id, status) VALUES (902, 'Arlesh', 'project', 901, 'active')",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    for sql in seed {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    let factory = SessionFactory::new(pool.clone());
    let heard = Arc::new(Mutex::new(Vec::new()));
    let sink: Sink = {
        let heard = Arc::clone(&heard);
        Arc::new(move |event| lock(&heard).push(event.clone()))
    };
    let publisher = BoardPublisher::start(
        factory.clone(),
        ChangeFeed::new(),
        clock.clone(),
        sink,
        &tokio::runtime::Handle::current(),
    );
    Rig {
        pool,
        factory,
        publisher,
        clock,
        heard,
    }
}

impl Rig {
    async fn write(&self, sql: &str) {
        sqlx::query(sql).execute(&self.pool).await.unwrap();
        self.publisher.record_write();
    }

    async fn next(&self, seq: u64) -> Vec<Value> {
        self.publisher
            .after(seq, Duration::from_secs(5))
            .await
            .iter()
            .map(|event| serde_json::from_str(&event.data).unwrap())
            .collect()
    }

    async fn quiet_after(&self, seq: u64) -> bool {
        self.publisher
            .after(seq, Duration::from_millis(300))
            .await
            .is_empty()
    }
}

const TASK: &str = "INSERT INTO tasks (id, title, parent_type, parent_id, status) VALUES (100, 'Docs', 'domain', 902, 'todo')";

#[tokio::test]
async fn a_write_then_a_recorded_write_publishes_one_event_with_the_written_task() {
    let rig = rig(TestClock::at(13, 12), &[]).await;
    assert_eq!(rig.publisher.current().await.seq, 1);

    rig.write(TASK).await;
    let events = rig.next(1).await;

    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["seq"], 2);
    assert_eq!(events[0]["revision"], 1);
    assert_eq!(events[0]["epoch"], &*rig.publisher.epoch());
    assert_eq!(events[0]["changes"]["tasks"]["set"][0][0], "task-100");
    assert_eq!(events[0]["changes"]["tasks"]["set"][0][1]["title"], "Docs");
    assert_eq!(lock(&rig.heard).len(), 1, "the sink heard it too");
}

#[tokio::test]
async fn writes_that_land_before_the_loop_runs_again_publish_one_event() {
    let rig = rig(TestClock::at(13, 12), &[]).await;
    rig.publisher.current().await;
    for id in 100..103 {
        let sql = format!("INSERT INTO tasks (id, title, parent_type, parent_id) VALUES ({id}, 'T', 'domain', 902)");
        sqlx::query(&sql).execute(&rig.pool).await.unwrap();
    }

    for _ in 0..3 {
        rig.publisher.record_write();
    }
    let events = rig.next(1).await;

    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["revision"], 3);
    assert_eq!(
        events[0]["changes"]["tasks"]["set"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert!(rig.quiet_after(2).await);
}

#[tokio::test]
async fn a_tick_that_changes_nothing_publishes_nothing() {
    let rig = rig(TestClock::at(13, 12), &[TASK]).await;
    rig.publisher.current().await;

    rig.clock.tick_at(13, 13);

    assert!(rig.quiet_after(1).await);
    assert_eq!(rig.publisher.head().unwrap().seq, 1);
}

#[tokio::test]
async fn a_tick_past_a_due_date_publishes_the_overdue_lifecycle_with_the_hash_of_that_instant() {
    let day = r#"'{"kind":"day","date":"2026-11-13"}'"#;
    let due = format!(
        "INSERT INTO tasks (id, title, parent_type, parent_id, time_scope_start_id, time_scope_end_id, on_scope_exit) \
         VALUES (100, 'Due', 'domain', 902, {day}, {day}, 'keep')"
    );
    let rig = rig(TestClock::at(13, 12), &[&due]).await;
    assert_eq!(rig.publisher.current().await.seq, 1);

    rig.clock.tick_at(14, 3);
    let events = rig.next(1).await;

    assert_eq!(events.len(), 1);
    let lifecycle = &events[0]["changes"]["lifecycles"]["set"][0];
    assert_eq!(lifecycle[0], "task-100");
    assert_eq!(lifecycle[1]["overdue"], true);
    let mut db = rig.factory.begin().await.unwrap();
    let fresh = crate::mindmap::current(&mut db, moment(14, 3))
        .await
        .unwrap();
    db.commit().await.unwrap();
    assert_eq!(
        events[0]["hash"],
        BoardDigests::seed(&fresh).unwrap().total()
    );
}

#[tokio::test]
async fn an_oversized_change_says_reload_instead_of_carrying_its_changes() {
    let rig = rig(TestClock::at(13, 12), &[]).await;
    rig.publisher.current().await;

    rig.write(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1500) \
         INSERT INTO tasks (title, parent_type, parent_id) \
         SELECT printf('%0300d', i), 'domain', 902 FROM n",
    )
    .await;
    let events = rig.next(1).await;

    assert_eq!(events[0]["reload"], true);
    assert!(events[0].get("changes").is_none());
    assert_eq!(events[0]["seq"], 2);
}

#[tokio::test]
async fn after_replays_the_ring_in_order() {
    let rig = rig(TestClock::at(13, 12), &[]).await;
    rig.publisher.current().await;
    for id in 100..103 {
        rig.write(&format!(
            "INSERT INTO tasks (id, title, parent_type, parent_id) VALUES ({id}, 'T', 'domain', 902)"
        ))
        .await;
        rig.next(id as u64 - 100 + 1).await;
    }

    let events = rig.next(1).await;

    let seqs: Vec<_> = events
        .iter()
        .map(|event| event["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs, [2, 3, 4]);
    assert!(events.iter().all(|event| event.get("reload").is_none()));
}

#[tokio::test]
async fn after_says_reload_once_the_ring_has_dropped_what_was_asked() {
    let rig = rig(TestClock::at(13, 12), &[]).await;
    rig.publisher.current().await;
    for id in 0..70u64 {
        rig.write(&format!(
            "INSERT INTO tasks (id, title, parent_type, parent_id) VALUES ({}, 'T', 'domain', 902)",
            100 + id
        ))
        .await;
        rig.next(id + 1).await;
    }

    let behind = rig.next(1).await;
    let from_the_start = rig.next(0).await;

    assert_eq!(behind.len(), 1);
    assert_eq!(behind[0]["reload"], true);
    assert_eq!(behind[0]["seq"], 71);
    assert_eq!(from_the_start.len(), 1);
    assert_eq!(from_the_start[0]["reload"], true);
}

#[tokio::test]
async fn a_publications_revision_never_counts_a_write_its_board_lacks() {
    let rig = rig(TestClock::at(13, 12), &[]).await;
    rig.publisher.current().await;

    for id in 0..5u64 {
        rig.write(&format!(
            "INSERT INTO tasks (id, title, parent_type, parent_id) VALUES ({}, 'T', 'domain', 902)",
            100 + id
        ))
        .await;
        rig.next(id + 1).await;
        let publication = rig.publisher.current().await;
        assert!(publication.load.tasks.len() as u64 >= publication.revision);
    }
}

#[tokio::test]
async fn the_head_names_the_latest_publication() {
    let rig = rig(TestClock::at(13, 12), &[TASK]).await;
    let publication = rig.publisher.current().await;

    let head = rig.publisher.head().unwrap();

    assert_eq!((head.seq, head.revision), (1, 0));
    assert_eq!(head.hash, publication.hash);
    assert_eq!(head.epoch, &*rig.publisher.epoch());
    assert!(head.sums.contains_key("tasks"));
    assert_eq!(rig.publisher.fence().revision, 0);
}
