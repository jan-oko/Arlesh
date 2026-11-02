//! `arlesh-server`'s pending device pairings (migration 0098).
//!
//! The table is the server's own: the desktop app never reads it, and it is not journaled
//! ([`crate::undo::EXCLUDED_TABLES`]). This operator only stores, finds and removes rows; the
//! rules (a PIN's lifetime, the wrong-attempt limit, naming) are the server's.

pub mod model;

use model::PairingPin;

#[derive(sqlx::FromRow)]
struct PairingPinRow {
    id_sha256: String,
    pin: String,
    name: String,
    approved_name: Option<String>,
    attempts: i64,
    created_at: String,
    expires_at: String,
}

impl From<PairingPinRow> for PairingPin {
    fn from(row: PairingPinRow) -> Self {
        Self {
            id_sha256: row.id_sha256,
            pin: row.pin,
            name: row.name,
            approved_name: row.approved_name,
            attempts: row.attempts,
            created_at: row.created_at,
            expires_at: row.expires_at,
        }
    }
}

/// Reads and writes the server's pending pairings, on a session's connection.
///
/// Obtained as `db.pairing_pins()`; see [`Db`](crate::database::session::Db) for the borrow
/// rules.
pub struct PairingPinOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> PairingPinOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Records a new request. Answers `false`, writing nothing, when the PIN or the id is
    /// already in use.
    #[tracing::instrument(skip_all)]
    pub async fn create(&mut self, pin: &PairingPin) -> Result<bool, sqlx::Error> {
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO pairing_pins \
             (id_sha256, pin, name, approved_name, attempts, created_at, expires_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&pin.id_sha256)
        .bind(&pin.pin)
        .bind(&pin.name)
        .bind(&pin.approved_name)
        .bind(pin.attempts)
        .bind(&pin.created_at)
        .bind(&pin.expires_at)
        .execute(&mut *self.connection)
        .await?
        .rows_affected();
        Ok(inserted == 1)
    }

    /// Every request, oldest first.
    #[tracing::instrument(skip(self))]
    pub async fn all(&mut self) -> Result<Vec<PairingPin>, sqlx::Error> {
        let rows: Vec<PairingPinRow> = sqlx::query_as(
            "SELECT id_sha256, pin, name, approved_name, attempts, created_at, expires_at \
             FROM pairing_pins ORDER BY created_at, pin",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Deletes every request that lapsed at or before `now` (ISO 8601, so text order is time
    /// order). Answers how many.
    #[tracing::instrument(skip(self))]
    pub async fn purge_expired(&mut self, now: &str) -> Result<u64, sqlx::Error> {
        Ok(
            sqlx::query("DELETE FROM pairing_pins WHERE expires_at <= ?")
                .bind(now)
                .execute(&mut *self.connection)
                .await?
                .rows_affected(),
        )
    }

    /// Counts one more wrong PIN against a request, and answers the count now. `None`: no such
    /// request.
    #[tracing::instrument(skip_all)]
    pub async fn count_attempt(&mut self, id_sha256: &str) -> Result<Option<i64>, sqlx::Error> {
        sqlx::query_scalar(
            "UPDATE pairing_pins SET attempts = attempts + 1 WHERE id_sha256 = ? \
             RETURNING attempts",
        )
        .bind(id_sha256)
        .fetch_optional(&mut *self.connection)
        .await
    }

    /// Approves the not-yet-approved request with `pin` under `name`. Answers `false` when there
    /// is none.
    #[tracing::instrument(skip(self))]
    pub async fn approve(&mut self, pin: &str, name: &str) -> Result<bool, sqlx::Error> {
        let approved = sqlx::query(
            "UPDATE pairing_pins SET approved_name = ? WHERE pin = ? AND approved_name IS NULL",
        )
        .bind(name)
        .bind(pin)
        .execute(&mut *self.connection)
        .await?
        .rows_affected();
        Ok(approved == 1)
    }

    /// Deletes a request. Answers `false` when there was none.
    #[tracing::instrument(skip_all)]
    pub async fn delete(&mut self, id_sha256: &str) -> Result<bool, sqlx::Error> {
        let removed = sqlx::query("DELETE FROM pairing_pins WHERE id_sha256 = ?")
            .bind(id_sha256)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        Ok(removed == 1)
    }
}

#[cfg(test)]
mod tests;
