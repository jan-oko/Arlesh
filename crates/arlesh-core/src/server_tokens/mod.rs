//! `arlesh-server`'s bearer tokens: one per client, kept as a SHA-256 digest (migration 0097).
//!
//! The table is the server's own: the desktop app never reads it, and it is not journaled, since
//! issuing or revoking a token is not a board edit ([`crate::undo::EXCLUDED_TABLES`]). The digest
//! is computed by the caller; this operator only stores, finds and removes it.

pub mod model;

use model::IssuedToken;

#[derive(sqlx::FromRow)]
struct IssuedTokenRow {
    client: String,
    created_at: String,
}

impl From<IssuedTokenRow> for IssuedToken {
    fn from(row: IssuedTokenRow) -> Self {
        Self {
            client: row.client,
            created_at: row.created_at,
        }
    }
}

/// Reads and writes the server's tokens, on a session's connection.
///
/// Obtained as `db.server_tokens()`; see [`Db`](crate::database::session::Db) for the borrow
/// rules.
pub struct ServerTokenOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> ServerTokenOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Records `client`'s token by its digest. Answers `false`, writing nothing, when the client
    /// already holds one or the digest is already someone's.
    #[tracing::instrument(skip(self, sha256))]
    pub async fn add(
        &mut self,
        client: &str,
        sha256: &str,
        created_at: &str,
    ) -> Result<bool, sqlx::Error> {
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO server_tokens (client, sha256, created_at) VALUES (?, ?, ?)",
        )
        .bind(client)
        .bind(sha256)
        .bind(created_at)
        .execute(&mut *self.connection)
        .await?
        .rows_affected();
        Ok(inserted == 1)
    }

    /// Removes `client`'s token. Answers `false` when it had none.
    #[tracing::instrument(skip(self))]
    pub async fn revoke(&mut self, client: &str) -> Result<bool, sqlx::Error> {
        let removed = sqlx::query("DELETE FROM server_tokens WHERE client = ?")
            .bind(client)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        Ok(removed == 1)
    }

    /// Every client holding a token, by name.
    #[tracing::instrument(skip(self))]
    pub async fn issued(&mut self) -> Result<Vec<IssuedToken>, sqlx::Error> {
        let rows: Vec<IssuedTokenRow> =
            sqlx::query_as("SELECT client, created_at FROM server_tokens ORDER BY client")
                .fetch_all(&mut *self.connection)
                .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// The client whose token has the digest `sha256`, if anyone's does.
    #[tracing::instrument(skip_all)]
    pub async fn client_for(&mut self, sha256: &str) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar("SELECT client FROM server_tokens WHERE sha256 = ?")
            .bind(sha256)
            .fetch_optional(&mut *self.connection)
            .await
    }
}
