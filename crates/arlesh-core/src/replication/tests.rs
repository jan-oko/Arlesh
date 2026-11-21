//! The rules, and the change log against the real schema.
//!
//! The schema-driven tests read `sqlite_master` rather than list tables, so a table added later
//! fails them by existing, the way `tests/undo_journal.rs` does for the undo triggers.

use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

use super::{
    rules::{coalesce, decide_capture, hash, is_replicated, Capture, SourceTracker},
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

#[test]
fn a_lease_is_renewed_by_its_owner_refused_to_another_and_taken_once_it_lapses() {
    // Held by me, valid.
    assert_eq!(decide_capture(Some("a"), 200, 100, "a"), Capture::Renewed);
    // Held by another, valid: neither drain nor take.
    assert_eq!(decide_capture(Some("b"), 200, 100, "a"), Capture::Refused);
    // Another's lapsed, never held, released.
    assert_eq!(decide_capture(Some("b"), 100, 100, "a"), Capture::Acquired);
    assert_eq!(decide_capture(None, 0, 100, "a"), Capture::Acquired);
    // Mine, but it lapsed: the log has a gap, so it starts again from the rows.
    assert_eq!(decide_capture(Some("a"), 99, 100, "a"), Capture::Acquired);
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

/// Takes the capture as `owner` in its own transaction.
async fn hold(factory: &SessionFactory, owner: &str) -> Turn {
    let mut db = factory.begin().await.unwrap();
    let turn = take_turn(&mut db, owner).await.unwrap();
    db.commit().await.unwrap();
    turn
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
async fn every_change_trigger_names_every_column_of_its_table() {
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
            match rules::redaction(&table, &column) {
                Some(expression) => {
                    let stood_in =
                        format!("'{column}', {}", expression.replace("\"id\"", "new.id"));
                    assert!(
                        insert.contains(&stood_in) && update.contains(&stood_in),
                        "{table}.{column} must hold its stand-in {stood_in}"
                    );
                    assert!(
                        !insert.contains(&format!("new.{column}")),
                        "{table}.{column} travels"
                    );
                }
                None => {
                    let named = format!("'{column}', new.{column}");
                    assert!(
                        insert.contains(&named) && update.contains(&named),
                        "the change triggers of {table} do not name {column}: a migration changed \
                         the columns without regenerating them"
                    );
                    assert!(
                        update.contains(&format!("old.{column} IS NOT new.{column}")),
                        "the update trigger of {table} does not watch {column}"
                    );
                }
            }
        }
    }
}

#[tokio::test]
async fn the_log_is_written_only_while_a_publisher_holds_a_valid_lease() {
    let pool = pool().await;
    let factory = SessionFactory::new(pool.clone());
    let count = || async {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM change_log")
            .fetch_one(&pool)
            .await
            .unwrap()
    };
    let add = |id: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query("INSERT INTO domains (id, title, subtype) VALUES (?, ?, 'aspect')")
                .bind(id)
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
    };

    add("d-1").await;
    let never_held = count().await;
    hold(&factory, "me").await;
    add("d-2").await;
    let held = count().await;
    sqlx::query("UPDATE change_capture SET leased_until = 0")
        .execute(&pool)
        .await
        .unwrap();
    add("d-3").await;
    let lapsed = count().await;

    assert_eq!(
        (never_held, held, lapsed),
        (0, 1, 1),
        "a crashed publisher's lease runs out and the log stops growing by itself"
    );
}

#[tokio::test]
async fn an_update_that_changes_nothing_a_device_holds_logs_nothing() {
    let pool = pool().await;
    let factory = SessionFactory::new(pool.clone());
    sqlx::query(
        "INSERT INTO agents (id, name, account, session_uuid, token_sha256, locked, created_at, last_seen_at) \
         VALUES (1, 'a', 'default', 's', 'SECRET', 0, 'x', 'x')",
    )
    .execute(&pool)
    .await
    .unwrap();
    hold(&factory, "me").await;

    sqlx::query("UPDATE agents SET last_seen_at = 'later', token_sha256 = 'ROTATED' WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();
    let after_bookkeeping: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE agents SET locked = 1 WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();
    let after_lock: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!((after_bookkeeping, after_lock), (0, 1));
}

#[tokio::test]
async fn a_logged_image_is_the_image_a_snapshot_reads() {
    let pool = pool().await;
    let factory = SessionFactory::new(pool.clone());
    hold(&factory, "me").await;

    sqlx::query(
        "INSERT INTO domains (id, title, subtype, description) VALUES ('d-1', 'It''s \"One\"', 'aspect', NULL)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO agents (id, name, account, session_uuid, token_sha256, locked, created_at) \
         VALUES (7, 'a', 'default', 's', 'SECRET', 0, 'x')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let Turn::Renewed(drained) = hold(&factory, "me").await else {
        panic!("the holder renews");
    };
    let mut db = factory.begin_read().await.unwrap();
    let rows = snapshot(&mut db).await.unwrap().rows;
    for logged in &drained.entries {
        let read = rows
            .iter()
            .find(|row| row.table == logged.table && row.rowid == logged.rowid)
            .unwrap();
        assert_eq!(
            logged.image.as_deref(),
            Some(read.image.as_str()),
            "{}",
            logged.table
        );
    }
    assert_eq!(drained.entries.len(), 2);
    assert_eq!(drained.hash, hash::board_hash(&drained.rows));
}

#[tokio::test]
async fn a_turn_takes_the_log_and_leaves_the_position() {
    let pool = pool().await;
    let factory = SessionFactory::new(pool.clone());
    assert!(matches!(hold(&factory, "me").await, Turn::Acquired(_)));
    for id in ["a", "b"] {
        sqlx::query("INSERT INTO domains (id, title, subtype) VALUES (?, ?, 'aspect')")
            .bind(id)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
    }

    let Turn::Renewed(first) = hold(&factory, "me").await else {
        panic!("renewed");
    };
    let Turn::Renewed(second) = hold(&factory, "me").await else {
        panic!("renewed");
    };

    assert_eq!(first.entries.len(), 2);
    assert!(
        second.entries.is_empty(),
        "nothing accumulates: the log was consumed"
    );
    assert_eq!(second.position, first.entries.last().unwrap().seq);
}

#[tokio::test]
async fn a_second_publisher_is_refused_and_touches_nothing() {
    let pool = pool().await;
    let factory = SessionFactory::new(pool.clone());
    hold(&factory, "first").await;
    sqlx::query("INSERT INTO domains (id, title, subtype) VALUES ('a', 'a', 'aspect')")
        .execute(&pool)
        .await
        .unwrap();

    let refused = hold(&factory, "second").await;
    let logged: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    let owner: String = sqlx::query_scalar("SELECT owner FROM change_capture")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert!(matches!(refused, Turn::Refused));
    assert_eq!(
        (logged, owner.as_str()),
        (1, "first"),
        "it neither drained nor took the capture"
    );
}

#[tokio::test]
async fn releasing_the_capture_stops_the_log_and_only_its_owner_can() {
    let pool = pool().await;
    let factory = SessionFactory::new(pool.clone());
    hold(&factory, "me").await;

    let mut db = factory.begin().await.unwrap();
    release_capture(&mut db, "someone else").await.unwrap();
    db.commit().await.unwrap();
    let still: i64 = sqlx::query_scalar("SELECT leased_until > 0 FROM change_capture")
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut db = factory.begin().await.unwrap();
    release_capture(&mut db, "me").await.unwrap();
    db.commit().await.unwrap();
    sqlx::query("INSERT INTO domains (id, title, subtype) VALUES ('a', 'a', 'aspect')")
        .execute(&pool)
        .await
        .unwrap();
    let logged: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!((still, logged), (1, 0));
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
    let agent = snapshot
        .rows
        .iter()
        .find(|row| row.table == "agents")
        .unwrap();
    assert!(
        agent.image.contains(r#""token_sha256":"redacted:1""#),
        "{}",
        agent.image
    );
    assert!(
        agent.image.contains(r#""last_seen_at":null"#),
        "{}",
        agent.image
    );
    assert!(snapshot.rows.iter().all(|row| is_replicated(&row.table)));
    assert!(snapshot.schema_version >= 111);
    assert_eq!(snapshot.hash, hash::board_hash(&snapshot.rows));
}

/// What identity-by-`rowid` forbids (ADR 0017, decision 5; `docs/spec/client-mode.md`, *The source
/// rows*). A row is named by its SQLite `rowid`, which is implicit on every table since 0107 made the
/// keys TEXT. `VACUUM` and any table rebuild renumber rowids without firing a trigger, an
/// `INSERT OR REPLACE` (or `ON CONFLICT REPLACE`) deletes a conflicting row without firing its delete
/// trigger, and a WITHOUT ROWID table has no `rowid` for the triggers to name.
#[tokio::test]
async fn nothing_replicated_is_without_rowid_or_replaces_on_conflict() {
    let pool = pool().await;
    let defined: Vec<(String, String)> = sqlx::query_as(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for (name, sql) in defined.into_iter().filter(|(name, _)| is_replicated(name)) {
        let sql = sql.to_uppercase();
        assert!(
            !sql.contains("WITHOUT ROWID"),
            "{name} is WITHOUT ROWID: it has no rowid to log"
        );
        assert!(
            !sql.contains("ON CONFLICT REPLACE"),
            "{name} replaces on conflict: a deletion no trigger sees"
        );
    }
}

#[test]
fn no_runtime_code_vacuums_or_replaces_into_a_table() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let roots = [
        manifest.join("src"),
        manifest.join("../arlesh-backend/src"),
        manifest.join("../arlesh-py/src"),
        manifest.join("../../src-tauri/src"),
    ];
    let mut found = Vec::new();
    for root in roots {
        scan(&root, &mut found);
    }
    assert!(
        found.is_empty(),
        "VACUUM and INSERT OR REPLACE / REPLACE INTO change or delete rows without a change-log \
         trigger (a rowid renumbered, a row replaced): {found:?}"
    );
}

fn scan(directory: &std::path::Path, found: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan(&path, found);
            continue;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if !name.ends_with(".rs") || name == "tests.rs" || name.ends_with("_tests.rs") {
            continue;
        }
        // The Replica's own apply: capture is off and the journal suppressed there, so nothing
        // needs to see the row it replaces (and foreign keys are off, so nothing cascades).
        if path.ends_with("replication/mod.rs") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for (number, line) in text.lines().enumerate() {
            let code = line.split("//").next().unwrap_or("").to_uppercase();
            if ["VACUUM", "INSERT OR REPLACE", "REPLACE INTO"]
                .iter()
                .any(|banned| code.contains(banned))
            {
                found.push(format!("{}:{}", path.display(), number + 1));
            }
        }
    }
}

/// The canonical text depends on column order being the server's and the client's alike (ADR 0017,
/// decision 13: one schema version). A database that ran the chain from nothing and one made from
/// the baseline plus the newer migrations must agree for every replicated table.
#[tokio::test]
async fn the_chain_and_the_baseline_give_every_replicated_table_the_same_column_order() {
    let from_baseline = pool().await;
    let from_chain = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::database::run_chain(&from_chain, &crate::database::MIGRATOR)
        .await
        .unwrap();

    for table in tables(&from_baseline)
        .await
        .into_iter()
        .filter(|t| is_replicated(t))
    {
        let order = |pool: &SqlitePool| {
            let table = table.clone();
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, String>(
                    "SELECT name FROM pragma_table_info(?) ORDER BY cid",
                )
                .bind(table)
                .fetch_all(&pool)
                .await
                .unwrap()
            }
        };
        assert_eq!(
            order(&from_baseline).await,
            order(&from_chain).await,
            "{table}"
        );
    }
}
