use std::borrow::Cow;

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

use super::*;
use crate::database::{migrate, MIGRATOR};

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

/// The chain up to and including `last`, run the way it ran before the baseline existed.
async fn chain_through(last: i64) -> SqlitePool {
    let pool = empty_database().await;
    let partial = Migrator {
        migrations: Cow::Owned(
            MIGRATOR
                .iter()
                .filter(|migration| migration.version <= last)
                .cloned()
                .collect(),
        ),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    };
    partial.run(&pool).await.unwrap();
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
async fn a_database_at_91_runs_the_rest_of_the_chain() {
    let behind = chain_through(91).await;
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
