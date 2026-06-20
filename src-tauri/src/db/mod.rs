//! Database connection and migration management.

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

/// Shared connection pool type used throughout the application.
pub type DbPool = SqlitePool;

/// Opens a SQLite connection pool at the given file path.
pub async fn connect(db_url: &str) -> anyhow::Result<DbPool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect(db_url)
        .await?;
    Ok(pool)
}

/// Runs all pending migrations against the pool.
pub async fn run_migrations(pool: &DbPool) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}
