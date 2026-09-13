//! Database connection and migration management.

pub mod session;

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

/// Shared connection pool type used throughout the application.
pub type DatabasePool = SqlitePool;

/// Opens a SQLite connection pool at the given file path.
pub async fn connect(database_url: &str) -> anyhow::Result<DatabasePool> {
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
        .connect(database_url)
        .await?;
    Ok(pool)
}

/// Runs all pending migrations against the pool.
pub async fn run_migrations(pool: &DatabasePool) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}
