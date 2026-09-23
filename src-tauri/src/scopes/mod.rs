//! Time scopes: Seasons, Months, Weeks, Days, Parts of Day, and Exact windows.
//!
//! A scope is **derived**, not stored (ADR 0009). Its identity is its value key
//! ([`key::ScopeKey`], e.g. `week:2026-09-20`), and every field — label, dates, bounds — is
//! arithmetic over that key. The one thing kept in the database is the set of Exact windows that
//! something references, in `exact_scopes`, so that a column holding an exact key keeps its
//! referential integrity; [`ScopeOperator`] is how a write registers one.

mod derive;
pub mod error;
pub mod key;
pub mod model;
pub mod resolve;

use chrono::NaiveDateTime;

use error::ScopeError;
use key::ScopeKey;
use resolve::EXACT_DATETIME_FORMAT;

/// Registers the Exact windows a write is about to reference, on a session's connection.
///
/// Obtained as `db.scopes()` and used inline; see [`Db`](crate::database::session::Db) for the
/// borrow rules. Nothing else about a scope touches the database: a canonical key is valid by
/// construction, and reading any scope — exact ones included — is [`ScopeKey::scope`].
pub struct ScopeOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> ScopeOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Makes `key` referenceable: an Exact key gets its `exact_scopes` row if it has none; any
    /// other key needs nothing and is left alone.
    ///
    /// Call it before writing a key into a scope column. Only a **write** calls it — a read
    /// derives the same key without a row, which is what keeps every read free of writes. Its one
    /// statement is idempotent, so a lost race is the other writer's identical row.
    pub async fn register(&mut self, key: &ScopeKey) -> Result<(), ScopeError> {
        if !key.is_exact() {
            return Ok(());
        }
        let (start, end) = key.bounds();
        let at = |instant: NaiveDateTime| instant.format(EXACT_DATETIME_FORMAT).to_string();
        sqlx::query(
            "INSERT INTO exact_scopes (id, start_datetime, end_datetime) VALUES (?, ?, ?)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(key)
        .bind(at(start))
        .bind(at(end))
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Registers every key in `keys`; see [`Self::register`].
    pub async fn register_all(
        &mut self,
        keys: impl IntoIterator<Item = ScopeKey>,
    ) -> Result<(), ScopeError> {
        for key in keys {
            self.register(&key).await?;
        }
        Ok(())
    }
}
