use super::*;
use crate::database::session::SessionFactory;
use crate::database::DatabasePool;
use crate::nodes::id::{tid, RowId};
use sqlx::sqlite::SqlitePoolOptions;

async fn scratch_pool() -> DatabasePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("failed to open in-memory SQLite");
    crate::database::run_migrations(&pool)
        .await
        .expect("migrations failed");
    // Rows are written directly, parents and tags included, without the rows they would name.
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&pool)
        .await
        .expect("pragma");
    pool
}

async fn task(pool: &DatabasePool, id: i64, parent: (&str, i64), status: &str, extra: &str) {
    sqlx::query(&format!(
        "INSERT INTO tasks (id, title, parent_type, parent_id, status{}) VALUES (?, 't', ?, ?, ?{})",
        if extra.is_empty() { "" } else { ", " },
        if extra.is_empty() { String::new() } else { format!(", {extra}") }
    ))
    .bind(tid(id))
    .bind(parent.0)
    .bind(tid(parent.1))
    .bind(status)
    .execute(pool)
    .await
    .expect("insert task");
}

fn now() -> NaiveDateTime {
    chrono::NaiveDate::from_ymd_opt(2026, 11, 21)
        .and_then(|date| date.and_hms_opt(12, 0, 0))
        .expect("a date")
}

/// A board with every shape of Task: leaves in each status, a parent with children, a Compound
/// Task, an Asynchronous one, a Task that holds a wait, and one that holds a Commitment.
async fn seeded() -> (SessionFactory, Vec<(RowId, bool)>) {
    let pool = scratch_pool().await;
    task(&pool, 1, ("domain", 90), "todo", "").await;
    task(&pool, 2, ("domain", 90), "started", "").await;
    task(&pool, 3, ("domain", 90), "done", "").await;
    task(&pool, 4, ("domain", 90), "agentic_todo", "").await;
    task(&pool, 5, ("domain", 90), "todo", "").await; // a parent
    task(&pool, 6, ("task", 5), "in_progress", "").await;
    task(&pool, 7, ("task", 5), "todo", "").await;
    task(&pool, 8, ("domain", 90), "todo", "").await; // compound
    task(&pool, 9, ("task", 8), "done", "").await;
    task(&pool, 10, ("domain", 90), "todo", "").await; // asynchronous
    task(&pool, 11, ("domain", 90), "on_agent", "").await; // holds a wait
    task(&pool, 12, ("domain", 90), "todo", "").await; // holds a Commitment
    sqlx::query("UPDATE tasks SET compound = 1 WHERE id = ?")
        .bind(tid(8))
        .execute(&pool)
        .await
        .expect("compound");
    sqlx::query("UPDATE tasks SET asynchronous = 1 WHERE id = ?")
        .bind(tid(10))
        .execute(&pool)
        .await
        .expect("asynchronous");
    sqlx::query(
        "INSERT INTO expectations (id, title, parent_type, parent_id, agentic, agentic_question, status) \
         VALUES (?, 'question', 'task', ?, 1, 1, 'pending')",
    )
    .bind(tid(50))
    .bind(tid(11))
    .execute(&pool)
    .await
    .expect("wait");
    sqlx::query(
        "INSERT INTO commitments (id, title, parent_type, parent_id) VALUES (?, 'c', 'task', ?)",
    )
    .bind(tid(60))
    .bind(tid(12))
    .execute(&pool)
    .await
    .expect("commitment");
    // A Task a Habit targets: each iteration's root hangs under it, with no row beneath it.
    task(&pool, 13, ("domain", 90), "todo", "").await;
    let flow = tid(70).to_string();
    sqlx::query(
        "INSERT INTO flows (id, title, instance_type, parent_type, parent_id, target_type, target_id,
                            flow_duration_n, flow_duration_kind)
         VALUES (?, 'habit', 'task', 'domain', ?, 'task', ?, 1, 'week')",
    )
    .bind(&flow)
    .bind(tid(90).to_string())
    .bind(tid(13).to_string())
    .execute(&pool)
    .await
    .expect("habit");
    sqlx::query(
        "INSERT INTO flow_recurrences (flow_id, start_scope_id, gap_n, gap_kind, clock, miss_policy)
         VALUES (?, '{\"kind\":\"week\",\"date\":\"2026-11-15\"}', 1, 'week', 'interval', NULL)",
    )
    .bind(&flow)
    .execute(&pool)
    .await
    .expect("recurrence");
    sqlx::query(
        "INSERT INTO flow_tasks (id, flow_id, title, parent_type, parent_id)
         VALUES (?, ?, 'item', 'flow', ?)",
    )
    .bind(tid(71).to_string())
    .bind(&flow)
    .bind(&flow)
    .execute(&pool)
    .await
    .expect("item");
    // A delegated Task that is not Compound.
    task(&pool, 14, ("domain", 90), "todo", "").await;
    sqlx::query("UPDATE tasks SET delegate_kind = 'person', delegate_id = ? WHERE id = ?")
        .bind(tid(80).to_string())
        .bind(tid(14))
        .execute(&pool)
        .await
        .expect("delegate");
    // Only an archived child; only an Info beneath.
    task(&pool, 15, ("domain", 90), "todo", "").await;
    task(&pool, 16, ("task", 15), "todo", "").await;
    sqlx::query("UPDATE tasks SET archival = 'archived' WHERE id = ?")
        .bind(tid(16))
        .execute(&pool)
        .await
        .expect("archived");
    task(&pool, 17, ("domain", 90), "todo", "").await;
    sqlx::query("INSERT INTO infos (body, parent_type, parent_id) VALUES ('note', 'task', ?)")
        .bind(tid(17).to_string())
        .execute(&pool)
        .await
        .expect("info");
    // A stored Task written under the Habit's host and hung on an occurrence of it.
    task(&pool, 18, ("task", 13), "in_progress", "").await;
    sqlx::query(
        "INSERT INTO derived_children (flow_id, parent_kind, parent_key, child_type, child_id)
         VALUES (?, 'task', 'flow_root:x', 'task', ?)",
    )
    .bind(&flow)
    .bind(tid(18).to_string())
    .execute(&pool)
    .await
    .expect("hung child");
    let leaves = [1, 2, 3, 4, 6, 7, 9, 14, 17, 18].map(|n| (tid(n), true));
    let parents = [5, 8, 10, 11, 12, 13, 15].map(|n| (tid(n), false));
    (
        SessionFactory::new(pool),
        leaves.into_iter().chain(parents).collect(),
    )
}

#[tokio::test]
async fn a_leaf_is_served_as_the_derived_board_serves_it() {
    let (factory, tasks) = seeded().await;
    let mut db = factory.begin().await.expect("session");
    for (row, is_leaf) in tasks {
        let id = NodeId::Stored(row);
        let served = serve(&mut db, &id, now()).await.expect("serve");
        let from_board = serve_from_board(&mut db, &id, now()).await.expect("board");
        assert_eq!(served, from_board, "{row} served");
        let closed = require_closed(&mut db, &id, now())
            .await
            .map_err(|error| error.to_string());
        let closed_on_board = require_closed_from_board(&mut db, &id, now())
            .await
            .map_err(|error| error.to_string());
        assert_eq!(closed, closed_on_board, "{row} closing");
        let fast = stored_leaf(&mut db, &id).await.expect("leaf");
        assert_eq!(fast.is_some(), is_leaf, "{row} leaf-ness");
    }
}

/// The reading the board gives the Task a Habit targets is the one the fast path would miss, so
/// the case is pinned on its own: its open occurrence is a sub-item with no row beneath the Task.
#[tokio::test]
async fn a_task_a_habit_targets_reads_its_open_occurrence() {
    let (factory, _) = seeded().await;
    let mut db = factory.begin().await.expect("session");
    let id = NodeId::Stored(tid(13));
    let served = serve(&mut db, &id, now()).await.expect("serve");
    assert!(
        served.expect("held").sub_items.open > 0,
        "the occurrence is open beneath the Task"
    );
    assert!(require_closed(&mut db, &id, now()).await.is_err());
}

#[tokio::test]
async fn a_task_the_board_does_not_hold_is_served_as_none() {
    let (factory, _) = seeded().await;
    let mut db = factory.begin().await.expect("session");
    let missing = NodeId::Stored(tid(777));
    assert_eq!(serve(&mut db, &missing, now()).await.expect("serve"), None);
}

#[tokio::test]
async fn require_closed_refuses_a_parent_with_open_items_and_lets_a_leaf_through() {
    let (factory, _) = seeded().await;
    let mut db = factory.begin().await.expect("session");
    require_closed(&mut db, &NodeId::Stored(tid(1)), now())
        .await
        .expect("a leaf closes");
    assert!(require_closed(&mut db, &NodeId::Stored(tid(5)), now())
        .await
        .is_err());
}
