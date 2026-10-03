//! Opening an Arlesh database from outside the desktop app.
//!
//! The app opens its own database at startup, migrates it and holds it (see [`super::hold`]).
//! Every other host — the Python bindings, the service built on them — opens one here, and the
//! rules are the same for all of them:
//!
//! * **Read-only opens always work** while the schema is current, held or not. They never migrate:
//!   a schema that is **behind** is refused, because a reader may not change the file and this
//!   build cannot read an older shape.
//! * **A write-open** names its client ([`ClientId`]). It is refused while the desktop app holds
//!   the database, unless the caller insists with `force`. It runs any pending migrations, as the
//!   app does at startup.
//! * **A schema newer than this build** — a migration it does not know — is refused either way.

use std::path::{Path, PathBuf};

use sqlx::sqlite::SqliteConnectOptions;

use super::client::ClientId;
use super::hold::{self, HoldError};
use super::rules::{schema_state, SchemaState};
use super::session::SessionFactory;
use super::{connect_with, DatabasePool, MIGRATOR};

/// How a database is opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenMode {
    /// For reading only: never refused for the app's hold, never migrates.
    ReadOnly,
    /// For writing, as `client`.
    Write {
        /// Who the writes are from. The journal stamps every entry with it.
        client: ClientId,
        /// Open even while the desktop app holds the database.
        force: bool,
    },
}

/// Why a database could not be opened.
#[derive(Debug, thiserror::Error)]
pub enum OpenError {
    /// A read-only open named a file that does not exist. A write-open creates it instead.
    #[error("no database at {0}")]
    Missing(PathBuf),
    /// The desktop app holds the database, and the write-open did not insist.
    #[error(
        "the Arlesh app holds {0} while it runs; close it, open read-only, or open with force"
    )]
    HeldByApp(PathBuf),
    /// A read-only open found a schema older than this build; only a write-open migrates.
    #[error("the database's schema is behind this build (pending migrations {pending:?}); open it for writing once to migrate it")]
    SchemaBehind {
        /// The migrations not yet applied.
        pending: Vec<i64>,
    },
    /// The database carries migrations this build does not know: a newer Arlesh wrote it.
    #[error("the database's schema is newer than this build (unknown migrations {unknown:?}); update arlesh")]
    SchemaAhead {
        /// The migrations this build does not know.
        unknown: Vec<i64>,
    },
    /// The app's hold could not be checked.
    #[error(transparent)]
    Hold(#[from] HoldError),
    /// Migrating failed.
    #[error("migration failed: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    /// The database could not be reached.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Opens the database at `path` in `mode`, and hands back the factory its sessions come from.
#[tracing::instrument]
pub async fn open(path: &Path, mode: OpenMode) -> Result<SessionFactory, OpenError> {
    match mode {
        OpenMode::ReadOnly => open_read_only(path).await,
        OpenMode::Write { client, force } => open_for_writing(path, client, force).await,
    }
}

/// The read-only half of [`open`].
async fn open_read_only(path: &Path) -> Result<SessionFactory, OpenError> {
    if !path.exists() {
        return Err(OpenError::Missing(path.to_path_buf()));
    }
    let pool = connect_with(SqliteConnectOptions::new().filename(path), true).await?;
    match current_schema(&pool).await? {
        SchemaState::Current => Ok(SessionFactory::read_only(pool)),
        SchemaState::Behind { pending } => Err(OpenError::SchemaBehind { pending }),
        SchemaState::Ahead { unknown } => Err(OpenError::SchemaAhead { unknown }),
    }
}

/// The writing half of [`open`].
async fn open_for_writing(
    path: &Path,
    client: ClientId,
    force: bool,
) -> Result<SessionFactory, OpenError> {
    if hold::is_held(path)? {
        if !force {
            return Err(OpenError::HeldByApp(path.to_path_buf()));
        }
        tracing::warn!(path = %path.display(), "opening a held database for writing: forced");
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = connect_with(options, false).await?;
    if let SchemaState::Ahead { unknown } = current_schema(&pool).await? {
        return Err(OpenError::SchemaAhead { unknown });
    }
    MIGRATOR.run(&pool).await?;
    tracing::info!(client = %client, "database open for writing");
    Ok(SessionFactory::with_client(pool, client))
}

/// Where the database behind `pool` stands against this build's migrations.
async fn current_schema(pool: &DatabasePool) -> Result<SchemaState, sqlx::Error> {
    let known: Vec<i64> = MIGRATOR.iter().map(|migration| migration.version).collect();
    Ok(schema_state(&known, &applied_migrations(pool).await?))
}

/// The versions of every migration applied to the database, or none on a database sqlx has never
/// migrated. A migration that failed partway (`success = 0`) does not count as applied.
async fn applied_migrations(pool: &DatabasePool) -> Result<Vec<i64>, sqlx::Error> {
    let migrated: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await?;
    if !migrated {
        return Ok(Vec::new());
    }
    sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success = 1 ORDER BY version")
        .fetch_all(pool)
        .await
}

#[cfg(test)]
mod tests;
