//! The rules, and the change log against the real schema.
//!
//! The schema-driven tests read `sqlite_master` rather than list tables, so a table added later
//! fails them by existing, the way `tests/undo_journal.rs` does for the undo triggers.

use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

use super::{
    rules::{coalesce, hash, is_replicated, SourceTracker},
    *,
};
use crate::database::session::SessionFactory;

fn entry(seq: i64, table: &str, rowid: i64, image: Option<&str>) -> RowChange {
    RowChange {
        seq,
        table: table.to_owned(),
        rowid,
        image: image.map(str::to_owned),
    }
}

fn stored(table: &str, rowid: i64, image: &str) -> StoredRow {
    StoredRow {
        table: table.to_owned(),
        rowid,
        image: image.to_owned(),
    }
}

#[test]
fn a_digest_is_pinned_so_both_sides_hash_alike() {
    assert_eq!(
        format!(
            "{:016x}",
            hash::row_digest("tasks", 7, r#"{"id":"a","title":"Docs"}"#)
        ),
        "7b7fa9667061f695"
    );
}

#[test]
fn the_board_hash_is_the_same_in_any_order() {
    let rows = [
        stored("tasks", 1, r#"{"id":"a"}"#),
        stored("tasks", 2, r#"{"id":"b"}"#),
        stored("goals", 1, r#"{"id":"c"}"#),
    ];
    let mut reversed = rows.clone();
    reversed.reverse();

    assert_eq!(hash::board_hash(&rows), hash::board_hash(&reversed));
    assert_eq!(hash::board_hash(&rows).len(), 16);
}

#[test]
fn the_board_hash_sees_a_changed_row_and_a_row_that_moved_its_rowid() {
    let before = [stored("tasks", 1, r#"{"id":"a","title":"x"}"#)];
    let edited = [stored("tasks", 1, r#"{"id":"a","title":"y"}"#)];
    let renumbered = [stored("tasks", 2, r#"{"id":"a","title":"x"}"#)];

    assert_ne!(hash::board_hash(&before), hash::board_hash(&edited));
    assert_ne!(hash::board_hash(&before), hash::board_hash(&renumbered));
}

#[test]
fn coalescing_keeps_the_last_change_of_each_row_in_log_order() {
    let log = vec![
        entry(1, "tasks", 1, Some(r#"{"v":1}"#)),
        entry(2, "tasks", 2, Some(r#"{"v":1}"#)),
        entry(3, "tasks", 1, Some(r#"{"v":2}"#)),
        entry(4, "goals", 1, Some(r#"{"v":1}"#)),
    ];

    let changes = coalesce(log);

    let seqs: Vec<i64> = changes.iter().map(|change| change.seq).collect();
    assert_eq!(seqs, [2, 3, 4]);
    assert_eq!(changes[1].image.as_deref(), Some(r#"{"v":2}"#));
}

#[test]
fn a_row_made_and_deleted_in_one_burst_is_reported_deleted() {
    let changes = coalesce(vec![
        entry(1, "tasks", 5, Some(r#"{"v":1}"#)),
        entry(2, "tasks", 5, None),
    ]);

    assert_eq!(changes, [entry(2, "tasks", 5, None)]);
}

#[test]
fn a_rowid_deleted_and_taken_again_is_reported_as_the_new_row() {
    let changes = coalesce(vec![
        entry(1, "tasks", 5, None),
        entry(2, "tasks", 5, Some(r#"{"v":9}"#)),
    ]);

    assert_eq!(changes, [entry(2, "tasks", 5, Some(r#"{"v":9}"#))]);
}

#[test]
fn a_tracker_kept_current_by_changes_hashes_as_the_rows_do() {
    let start = [
        stored("tasks", 1, r#"{"id":"a"}"#),
        stored("tasks", 2, r#"{"id":"b"}"#),
    ];
    let mut tracker = SourceTracker::seed(&start, 10);

    let delta = tracker.advance(vec![
        entry(11, "tasks", 1, Some(r#"{"id":"a2"}"#)),
        entry(12, "tasks", 2, None),
        entry(13, "tasks", 3, Some(r#"{"id":"c"}"#)),
        entry(14, "tasks", 1, Some(r#"{"id":"a3"}"#)),
    ]);

    let end = [
        stored("tasks", 1, r#"{"id":"a3"}"#),
        stored("tasks", 3, r#"{"id":"c"}"#),
    ];
    assert_eq!((delta.base, delta.upto), (10, 14));
    assert_eq!(delta.hash, hash::board_hash(&end));
    assert_eq!(delta.rows.len(), 3);
    assert_eq!(tracker.head().upto, 14);
}

#[test]
fn a_delta_of_nothing_keeps_the_position_and_the_hash() {
    let mut tracker = SourceTracker::seed(&[stored("tasks", 1, "{}")], 7);
    let before = tracker.head();

    let delta = tracker.advance(Vec::new());

    assert!(delta.is_empty());
    assert_eq!((delta.base, delta.upto), (7, 7));
    assert_eq!(tracker.head(), before);
}

#[test]
fn server_only_tables_are_not_replicated() {
    for table in [
        "server_tokens",
        "pairing_pins",
        "agent_pins",
        "connect_tokens",
        "push_devices",
        "undo_journal",
        "change_log",
        "sqlite_sequence",
        "_sqlx_migrations",
    ] {
        assert!(!is_replicated(table), "{table} must stay on the server");
    }
    // `answer_drafts` is replicated to devices; keeping it from agents is the MCP's job (ADR 0021).
    for table in ["tasks", "answer_drafts", "agents", "mcp_roots"] {
        assert!(is_replicated(table), "{table} travels to devices");
    }
}

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::database::run_migrations(&pool).await.unwrap();
    pool
}

async fn tables(pool: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
           AND name <> '_sqlx_migrations' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn trigger_sql(pool: &SqlitePool, table: &str, operation: &str) -> Option<String> {
    sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .bind(format!("change_log_{table}_{operation}"))
        .fetch_optional(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn every_replicated_table_has_its_three_change_triggers_and_no_other_table_has_any() {
    let pool = pool().await;
    let mut missing = Vec::new();
    let mut stray = Vec::new();
    for table in tables(&pool).await {
        for operation in ["insert", "update", "delete"] {
            let present = trigger_sql(&pool, &table, operation).await.is_some();
            match (is_replicated(&table), present) {
                (true, false) => missing.push(format!("{table}_{operation}")),
                (false, true) => stray.push(format!("{table}_{operation}")),
                _ => {}
            }
        }
    }
    assert!(
        missing.is_empty(),
        "no change trigger for {missing:?}: a new table needs its three in a migration \
         (`scripts/generate-undo-triggers.sh change`), or a place in UNREPLICATED_TABLES with the \
         reason it stays on the server"
    );
    assert!(
        stray.is_empty(),
        "a server-only table is replicated: {stray:?}"
    );
}

#[tokio::test]
async fn every_change_trigger_names_every_column_of_its_table_but_the_omitted_ones() {
    let pool = pool().await;
    for table in tables(&pool).await.into_iter().filter(|t| is_replicated(t)) {
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info(?) ORDER BY cid")
                .bind(&table)
                .fetch_all(&pool)
                .await
                .unwrap();
        let insert = trigger_sql(&pool, &table, "insert").await.unwrap();
        let update = trigger_sql(&pool, &table, "update").await.unwrap();
        for column in columns {
            let named = |sql: &str| sql.contains(&format!("'{column}', new.{column}"));
            if rules::is_omitted(&table, &column) {
                assert!(
                    !named(&insert) && !named(&update),
                    "{table}.{column} travels"
                );
            } else {
                assert!(
                    named(&insert) && named(&update),
                    "the change triggers of {table} do not name {column}: a migration changed the \
                     columns without regenerating them"
                );
            }
        }
    }
}

#[tokio::test]
async fn the_log_is_written_only_while_capture_is_on() {
    let pool = pool().await;
    let factory = SessionFactory::new(pool.clone());

    sqlx::query("INSERT INTO domains (id, title, subtype) VALUES ('d-1', 'One', 'aspect')")
        .execute(&pool)
        .await
        .unwrap();
    let off: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    let mut db = factory.begin().await.unwrap();
    start_capture(&mut db).await.unwrap();
    db.commit().await.unwrap();
    sqlx::query("INSERT INTO domains (id, title, subtype) VALUES ('d-2', 'Two', 'aspect')")
        .execute(&pool)
        .await
        .unwrap();
    let on: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!((off, on), (0, 1));
}

#[tokio::test]
async fn a_logged_image_is_the_image_a_snapshot_reads() {
    let pool = pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.begin().await.unwrap();
    start_capture(&mut db).await.unwrap();
    db.commit().await.unwrap();

    sqlx::query(
        "INSERT INTO domains (id, title, subtype, description) VALUES ('d-1', 'It''s \"One\"', 'aspect', NULL)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let mut db = factory.begin().await.unwrap();
    let log = drain(&mut db).await.unwrap();
    db.commit().await.unwrap();
    let mut db = factory.begin_read().await.unwrap();
    let rows = snapshot(&mut db).await.unwrap().rows;
    let read = rows
        .iter()
        .find(|row| row.table == "domains" && row.image.contains("d-1"))
        .unwrap();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].image.as_deref(), Some(read.image.as_str()));
    assert_eq!(log[0].rowid, read.rowid);
}

#[tokio::test]
async fn draining_takes_the_log_and_leaves_the_position() {
    let pool = pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.begin().await.unwrap();
    start_capture(&mut db).await.unwrap();
    db.commit().await.unwrap();
    for id in ["a", "b"] {
        sqlx::query("INSERT INTO domains (id, title, subtype) VALUES (?, ?, 'aspect')")
            .bind(id)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
    }

    let mut db = factory.begin().await.unwrap();
    let drained = drain(&mut db).await.unwrap();
    db.commit().await.unwrap();
    let mut db = factory.begin().await.unwrap();
    let again = drain(&mut db).await.unwrap();
    db.commit().await.unwrap();
    let mut db = factory.begin_read().await.unwrap();
    let after = snapshot(&mut db).await.unwrap();

    assert_eq!(drained.len(), 2);
    assert!(
        again.is_empty(),
        "nothing accumulates: the log was consumed"
    );
    assert_eq!(
        after.upto,
        drained.last().unwrap().seq,
        "the position outlives the rows it counted"
    );
}

#[tokio::test]
async fn a_snapshot_holds_no_credential_and_no_server_only_table() {
    let pool = pool().await;
    sqlx::query(
        "INSERT INTO agents (id, name, account, session_uuid, token_sha256, locked, created_at, last_seen_at) \
         VALUES (1, 'a', 'default', 's', 'SECRETHASH', 0, 'x', 'x')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO server_tokens (client, sha256, created_at) VALUES ('phone', 'TOKENHASH', 'x')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.begin_read().await.unwrap();

    let snapshot = snapshot(&mut db).await.unwrap();

    let text: String = snapshot.rows.iter().map(|row| row.image.as_str()).collect();
    assert!(!text.contains("SECRETHASH") && !text.contains("TOKENHASH"));
    assert!(snapshot.rows.iter().any(|row| row.table == "agents"));
    assert!(snapshot.rows.iter().all(|row| is_replicated(&row.table)));
    assert!(snapshot.schema_version >= 111);
    assert_eq!(snapshot.hash, hash::board_hash(&snapshot.rows));
}
