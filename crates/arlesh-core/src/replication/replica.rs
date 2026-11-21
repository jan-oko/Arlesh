//! The Replica's database: the whole board in memory, written to by two hands that must never be
//! confused (ADR 0017, decisions 3 to 6).
//!
//! * **Predictions** are the app's own commands run on the Replica as they would run on the
//!   server. They are journaled (the undo journal's triggers fire), and that journal is what takes
//!   them back: [`settle`] replays everything past a mark as an inverse, then applies the rows the
//!   server confirmed, in one transaction.
//! * **Confirmed rows** are applied from a snapshot or a live event by `rowid` ([`apply_rows`],
//!   [`install_snapshot`]). They are never journaled, and never cascade: the server's rows already
//!   say what its cascades did.
//!
//! Capture stays off on a Replica (the change-log lease is never taken), so the change log's
//! triggers never fire. Every write here sets the journal's suppression flag inside its own
//! transaction and puts it back before committing, and runs with foreign keys off, set on the
//! connection before the transaction begins (SQLite ignores the pragma inside one) and back on
//! after it.
//!
//! The pool holds exactly one connection that never closes: an in-memory database lives only as
//! long as its connection does. Anything that asks for a second connection while one is held
//! fails after [`ACQUIRE_TIMEOUT`] instead of hanging.

use std::{str::FromStr, time::Duration};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

use super::model::{RowChange, Snapshot};
use crate::{
    database::{
        apply_connection_settings, run_migrations,
        session::{Db, SessionFactory, Transactional},
    },
    undo::{
        self,
        error::UndoError,
        model::{JournalEntry, RowOperation},
        statement::Replay,
    },
};

/// How long a second request for the Replica's one connection waits before it fails.
pub const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(10);

/// Why a Replica operation failed.
#[derive(Debug, thiserror::Error)]
pub enum ReplicaError {
    /// The database refused a statement.
    #[error("replica database: {0}")]
    Database(#[from] sqlx::Error),
    /// The undo journal could not be read or replayed.
    #[error("replica journal: {0}")]
    Undo(#[from] UndoError),
    /// The in-memory database could not be created or migrated.
    #[error("replica could not be opened: {0}")]
    Open(String),
    /// A row from the server named something that cannot be a replicated table or column, or
    /// carried an image that is not a row.
    #[error("replica row {table}/{rowid} is malformed: {reason}")]
    MalformedRow {
        /// The table the row named.
        table: String,
        /// The row's `rowid`.
        rowid: i64,
        /// What was wrong with it.
        reason: String,
    },
}

impl ReplicaError {
    pub(super) fn malformed(table: &str, rowid: i64, reason: impl Into<String>) -> Self {
        Self::MalformedRow {
            table: table.to_owned(),
            rowid,
            reason: reason.into(),
        }
    }
}

/// A span of the journal: the entries with `after < seq <= through`. What one prediction wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JournalRange {
    /// The mark taken before the prediction.
    pub after: i64,
    /// The mark taken after it.
    pub through: i64,
}

/// A table name that is safe to put in SQL and is one a Replica holds.
pub(super) fn check_table(table: &str) -> Result<(), ReplicaError> {
    let plain = !table.is_empty() && table.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if plain && super::is_replicated(table) {
        return Ok(());
    }
    Err(ReplicaError::malformed(table, 0, "not a replicated table"))
}

/// A column name that is safe to put in SQL.
pub(super) fn check_identifier(
    table: &str,
    rowid: i64,
    column: &str,
) -> Result<(), ReplicaError> {
    let plain = !column.is_empty() && column.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if plain {
        return Ok(());
    }
    Err(ReplicaError::malformed(table, rowid, "an unsafe column name"))
}

/// Creates the Replica's database: in memory, one connection that never closes, built from the
/// baseline and the migrations after it exactly as any database is, with an empty journal.
pub async fn open_memory() -> Result<SessionFactory, ReplicaError> {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")?;
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .acquire_timeout(ACQUIRE_TIMEOUT)
        .after_connect(|connection, _meta| {
            Box::pin(async move { apply_connection_settings(connection).await })
        })
        .connect_with(options)
        .await?;
    run_migrations(&pool)
        .await
        .map_err(|error| ReplicaError::Open(error.to_string()))?;
    let factory = SessionFactory::new(pool);
    undo::reset_journal(&factory).await?;
    Ok(factory)
}

/// Runs `write` in one immediate transaction with foreign keys off and the journal suppressed,
/// then commits, and puts foreign keys back whether it worked or not.
async fn unconstrained<T>(
    factory: &SessionFactory,
    write: impl AsyncFnOnce(&mut Db<Transactional>) -> Result<T, ReplicaError>,
) -> Result<T, ReplicaError> {
    factory.connect().await?.replication().set_foreign_keys(false).await?;
    let outcome = transaction(factory, write).await;
    let restored = factory
        .connect()
        .await?
        .replication()
        .set_foreign_keys(true)
        .await;
    let value = outcome?;
    restored?;
    Ok(value)
}

async fn transaction<T>(
    factory: &SessionFactory,
    write: impl AsyncFnOnce(&mut Db<Transactional>) -> Result<T, ReplicaError>,
) -> Result<T, ReplicaError> {
    let mut db = factory.begin().await?;
    db.undo().set_suppressed(true).await?;
    let value = write(&mut db).await?;
    db.undo().set_suppressed(false).await?;
    db.commit().await?;
    Ok(value)
}

async fn put_all(db: &mut Db<Transactional>, rows: &[RowChange]) -> Result<(), ReplicaError> {
    for row in rows {
        match &row.image {
            Some(image) => db.replication().put_row(&row.table, row.rowid, image).await?,
            None => db.replication().delete_row(&row.table, row.rowid).await?,
        }
    }
    Ok(())
}

/// Replaces every replicated row with the snapshot's, and empties the journal: the board the
/// server stands at, with no prediction on it.
pub async fn install_snapshot(
    factory: &SessionFactory,
    snapshot: &Snapshot,
) -> Result<(), ReplicaError> {
    unconstrained(factory, async |db| {
        install_rows(db, snapshot).await?;
        db.undo().discard_between(0, i64::MAX).await?;
        Ok(())
    })
    .await
}

async fn install_rows(db: &mut Db<Transactional>, snapshot: &Snapshot) -> Result<(), ReplicaError> {
    db.replication().clear_rows().await?;
    for row in &snapshot.rows {
        db.replication().put_row(&row.table, row.rowid, &row.image).await?;
    }
    Ok(())
}

/// Applies rows the server confirmed, in order, each as it last became (or gone).
pub async fn apply_rows(factory: &SessionFactory, rows: &[RowChange]) -> Result<(), ReplicaError> {
    unconstrained(factory, async |db| put_all(db, rows).await).await
}

/// The journal's newest `seq`: the mark a prediction is measured from.
pub async fn journal_mark(factory: &SessionFactory) -> Result<i64, ReplicaError> {
    let mut db = factory.connect().await?;
    Ok(db.undo().newest_seq().await?)
}

/// Takes every prediction past `mark` back, then applies the confirmed `rows`, in one transaction:
/// the board is never seen with the prediction gone and the answer not yet in. The reversed
/// entries are deleted with it.
pub async fn settle(
    factory: &SessionFactory,
    mark: i64,
    rows: &[RowChange],
) -> Result<(), ReplicaError> {
    unconstrained(factory, async |db| {
        reverse(db, mark, i64::MAX).await?;
        put_all(db, rows).await
    })
    .await
}

/// [`settle`], from a whole board rather than rows: every prediction past `mark` is taken back
/// (its entries deleted) and then the snapshot replaces every row.
pub async fn settle_with_snapshot(
    factory: &SessionFactory,
    mark: i64,
    snapshot: &Snapshot,
) -> Result<(), ReplicaError> {
    unconstrained(factory, async |db| {
        db.undo().discard_between(mark, i64::MAX).await?;
        install_rows(db, snapshot).await
    })
    .await
}

/// Takes back one prediction: the entries in `range`, reversed and deleted. Returns what it
/// reversed, oldest first, so the caller can say what the cancelled action had done.
pub async fn cancel(
    factory: &SessionFactory,
    range: JournalRange,
) -> Result<Vec<JournalEntry>, ReplicaError> {
    unconstrained(factory, async |db| {
        reverse(db, range.after, range.through).await
    })
    .await
}

async fn reverse(
    db: &mut Db<Transactional>,
    after: i64,
    through: i64,
) -> Result<Vec<JournalEntry>, ReplicaError> {
    let entries = db.undo().entries_between(after, through).await?;
    db.undo().replay(&entries, Replay::Inverse).await?;
    db.undo().discard_between(after, through).await?;
    Ok(entries)
}

/// The `id` of every row `range` inserted that has one: what a prediction made that the server
/// may have made differently (a Task a trigger or a cascade created, not one the press named).
pub async fn inserted_ids(
    factory: &SessionFactory,
    range: JournalRange,
) -> Result<Vec<String>, ReplicaError> {
    let mut db = factory.connect().await?;
    let entries = db.undo().entries_between(range.after, range.through).await?;
    Ok(entries
        .iter()
        .filter(|entry| entry.operation == RowOperation::Insert)
        .filter_map(|entry| entry.after.as_ref())
        .filter_map(|image| {
            image
                .columns()
                .find(|(column, _)| *column == "id")
                .and_then(|(_, value)| value.as_str().map(str::to_owned))
        })
        .collect())
}

/// The newest migration the Replica's database has applied: what a snapshot's schema must match.
pub async fn schema_version(factory: &SessionFactory) -> Result<i64, ReplicaError> {
    let mut db = factory.connect().await?;
    Ok(db.replication().schema_version().await?)
}

/// Empties the journal. Settling does it for the entries it reverses; this is for a Replica that
/// accepts its predictions as the server's.
pub async fn truncate_journal(factory: &SessionFactory) -> Result<(), ReplicaError> {
    let mut db = factory.connect().await?;
    db.undo().discard_between(0, i64::MAX).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
