use std::borrow::Cow;

use sqlx::migrate::{Migration, MigrationType};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

use super::*;
use crate::database::{migrate, migrate_with, MIGRATOR};

async fn empty_database() -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect("sqlite::memory:")
        .await
        .unwrap()
}

/// A migrator over the chain's migrations that `keep` accepts.
fn migrator(keep: impl Fn(i64) -> bool) -> Migrator {
    Migrator {
        migrations: Cow::Owned(
            MIGRATOR
                .iter()
                .filter(|migration| keep(migration.version))
                .cloned()
                .collect(),
        ),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    }
}

/// The chain up to and including `last`, run the way it ran before the baseline existed. Past the
/// baseline's version the id map migration 0107 reads is filled first, as `migrate` does.
async fn chain_through(last: i64) -> SqlitePool {
    let pool = empty_database().await;
    migrator(|version| version <= last.min(BASELINE_VERSION))
        .run(&pool)
        .await
        .unwrap();
    if last > BASELINE_VERSION {
        crate::database::row_ids::prepare(&pool).await.unwrap();
        migrator(|version| version <= last)
            .run(&pool)
            .await
            .unwrap();
    }
    pool
}

/// Everything about a database that two builds of it must share: its schema objects, every row of
/// every table, its autoincrement counters and the migrations it records as applied. The order the
/// objects were created in is not part of it.
async fn fingerprint(pool: &SqlitePool) -> Vec<String> {
    let mut lines: Vec<String> = sqlx::query_scalar(
        "SELECT type || ' ' || name || ' on ' || tbl_name || ': ' || COALESCE(sql, '') \
           FROM sqlite_master",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> '_sqlx_migrations'",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    for table in tables {
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info(?) ORDER BY cid")
                .bind(&table)
                .fetch_all(pool)
                .await
                .unwrap();
        if columns.is_empty() {
            continue;
        }
        let quoted = columns
            .iter()
            .map(|column| format!("quote(\"{column}\")"))
            .collect::<Vec<_>>()
            .join(" || ',' || ");
        let rows: Vec<String> =
            sqlx::query_scalar(&format!("SELECT {quoted} FROM \"{table}\" ORDER BY rowid"))
                .fetch_all(pool)
                .await
                .unwrap();
        lines.extend(rows.into_iter().map(|row| format!("row {table}: {row}")));
    }
    let recorded: Vec<String> = sqlx::query_scalar(
        "SELECT version || ' ' || description || ' ' || success || ' ' || hex(checksum) \
           FROM _sqlx_migrations",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    lines.extend(recorded.into_iter().map(|line| format!("migration {line}")));
    lines.sort();
    lines
}

#[test]
fn the_baseline_stands_for_a_migration_this_build_carries() {
    assert!(MIGRATOR
        .iter()
        .any(|migration| migration.version == BASELINE_VERSION));
}

#[tokio::test]
async fn a_fresh_database_is_the_baseline() {
    let pool = empty_database().await;
    assert!(is_fresh(&pool).await.unwrap());
    migrate(&pool).await.unwrap();
    assert!(!is_fresh(&pool).await.unwrap());
}

#[tokio::test]
async fn a_database_built_from_the_baseline_equals_one_the_chain_built() {
    let from_baseline = empty_database().await;
    migrate(&from_baseline).await.unwrap();
    let from_chain = chain_through(i64::MAX).await;

    assert_eq!(
        fingerprint(&from_baseline).await,
        fingerprint(&from_chain).await
    );
}

#[tokio::test]
async fn a_database_at_the_baseline_runs_the_rest_of_the_chain() {
    let behind = chain_through(BASELINE_VERSION).await;
    assert!(!is_fresh(&behind).await.unwrap());
    migrate(&behind).await.unwrap();

    assert_eq!(
        fingerprint(&behind).await,
        fingerprint(&chain_through(i64::MAX).await).await
    );
}

#[tokio::test]
async fn a_database_already_at_the_latest_migration_runs_nothing() {
    let pool = chain_through(i64::MAX).await;
    let before = fingerprint(&pool).await;
    let installed_before: Vec<String> =
        sqlx::query_scalar("SELECT installed_on FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();

    migrate(&pool).await.unwrap();

    let installed_after: Vec<String> =
        sqlx::query_scalar("SELECT installed_on FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(installed_after, installed_before);
    assert_eq!(fingerprint(&pool).await, before);
}

#[tokio::test]
async fn migrating_a_baseline_database_again_changes_nothing() {
    let pool = empty_database().await;
    migrate(&pool).await.unwrap();
    let before = fingerprint(&pool).await;
    migrate(&pool).await.unwrap();
    assert_eq!(fingerprint(&pool).await, before);
}

#[tokio::test]
async fn the_baseline_file_is_what_the_migrations_generate() {
    let generated = generate::render().await.unwrap();
    assert!(
        generated == BASELINE_SQL,
        "baseline/schema.sql is out of date with the migrations. Regenerate it:\n  \
         cargo run -p arlesh-core --example generate_baseline"
    );
}

#[tokio::test]
async fn a_migration_newer_than_the_baseline_runs_on_top_of_it() {
    let newer = BASELINE_VERSION + 1000;
    let mut migrations = MIGRATOR.migrations.to_vec();
    migrations.push(Migration::new(
        newer,
        Cow::Borrowed("add a probe table"),
        MigrationType::Simple,
        Cow::Borrowed("CREATE TABLE baseline_probe (id INTEGER PRIMARY KEY);"),
        false,
    ));
    let chain = Migrator {
        migrations: Cow::Owned(migrations),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    };

    let pool = empty_database().await;
    migrate_with(&pool, &chain).await.unwrap();

    let probe: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'baseline_probe'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let recorded: Vec<i64> =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(probe, 1);
    assert_eq!(recorded.last().copied(), Some(newer));
    assert_eq!(recorded.len(), MIGRATOR.iter().count() + 1);
}

#[tokio::test]
async fn rows_written_before_the_uuid_migration_keep_the_full_ids_they_were_shown_under() {
    let pool = chain_through(BASELINE_VERSION).await;
    sqlx::query(
        "INSERT INTO tasks (id, title, parent_type, parent_id) VALUES (5, 'T', 'domain', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    migrate(&pool).await.unwrap();

    let row: (String, String) = sqlx::query_as("SELECT id, parent_id FROM tasks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.0, crate::database::row_ids::new_id("task", 5));
    assert_eq!(row.1, crate::database::row_ids::new_id("domain", 1));
}

/// The bot's re-cut moves `version.txt` to the newest migration and renders again. Rendering past
/// 0106 used to run the raw chain and fail on 0107 ("NOT NULL constraint failed: domains.id"),
/// which failed the Bot workflow on every push to `dev` after #215. This is the re-cut's render, at
/// the newest migration, without touching `version.txt`.
#[tokio::test]
async fn the_bots_recut_renders_at_the_newest_migration() {
    let newest = MIGRATOR
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap();

    let text = super::generate::render_through(newest).await.unwrap();

    assert!(text.contains(&format!("migrations 1 through {newest}")));
    assert!(text.contains("CREATE TABLE change_log"));
    assert!(text.contains("CREATE TRIGGER change_log_tasks_insert"));
}
