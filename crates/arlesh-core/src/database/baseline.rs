//! The baseline: the schema at [`BASELINE_VERSION`], for a database that has never been migrated.
//!
//! Migrating an empty database through every migration is slow: the chain holds dozens of
//! `ALTER TABLE ... DROP COLUMN / RENAME` statements, and SQLite revalidates the whole schema
//! (every table, index and trigger) on each one. A fresh database therefore starts here instead:
//! `baseline/schema.sql` creates the finished schema in one pass, and [`install`] then records
//! migrations `1..=`[`BASELINE_VERSION`] as applied, with their real checksums, so the database is
//! indistinguishable from one the chain built.
//!
//! The migration files themselves are untouched and still drive every existing database: one at a
//! lower version runs the chain from where it stopped. `baseline/schema.sql` is generated from the
//! chain (`cargo run -p arlesh-core --example generate_baseline`) and a unit test fails when it drifts.
//! When a migration lands on master the bot re-cuts it to that migration (`scripts/recut-baseline.mjs`).

use sqlx::migrate::{Migrate, MigrateError, Migrator};
use sqlx::Executor;

use super::DatabasePool;

pub mod generate;

/// The last migration the baseline stands for. A migration with a higher number runs on top of it.
///
/// Read from `baseline/version.txt`, which the master bot rewrites together with `schema.sql` when
/// a migration lands (`scripts/recut-baseline.mjs`), so nobody re-cuts the baseline by hand.
pub const BASELINE_VERSION: i64 = parse_version(include_str!("../../baseline/version.txt"));

/// The number in `text`, ignoring surrounding whitespace; fails the build on anything else.
const fn parse_version(text: &str) -> i64 {
    let bytes = text.as_bytes();
    let mut version = 0i64;
    let mut digits = 0;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte.is_ascii_digit() {
            version = version * 10 + (byte - b'0') as i64;
            digits += 1;
        } else if !byte.is_ascii_whitespace() {
            panic!("baseline/version.txt must hold one number");
        }
        index += 1;
    }
    assert!(digits > 0, "baseline/version.txt must hold one number");
    version
}

/// The baseline schema and seed data, as `examples/generate_baseline.rs` writes them.
pub const BASELINE_SQL: &str = include_str!("../../baseline/schema.sql");

/// Whether `pool` is a database no migration has touched, so the baseline may start it.
///
/// A database sqlx created the bookkeeping table in but recorded nothing in is also fresh: that is
/// where an interrupted first run leaves it.
pub(super) async fn is_fresh(pool: &DatabasePool) -> Result<bool, sqlx::Error> {
    let has_bookkeeping: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await?;
    if !has_bookkeeping {
        return Ok(true);
    }
    let recorded: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await?;
    Ok(recorded == 0)
}

/// Creates the baseline schema in `pool` and records the migrations it stands for, as one
/// transaction: all of it lands or none does.
///
/// The versions, descriptions and checksums recorded come from `chain`, so a later run of the
/// chain finds exactly what it would have written itself.
pub(super) async fn install(pool: &DatabasePool, chain: &Migrator) -> Result<(), MigrateError> {
    let mut connection = pool.acquire().await?;
    connection.ensure_migrations_table().await?;
    let mut transaction = sqlx::Connection::begin(&mut *connection).await?;
    transaction.execute(sqlx::raw_sql(BASELINE_SQL)).await?;
    for migration in chain.iter().filter(|migration| {
        migration.version <= BASELINE_VERSION && !migration.migration_type.is_down_migration()
    }) {
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
             VALUES (?1, ?2, TRUE, ?3, 0)",
        )
        .bind(migration.version)
        .bind(&*migration.description)
        .bind(&*migration.checksum)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests;
