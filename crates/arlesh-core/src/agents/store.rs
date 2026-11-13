//! Reads and writes the agents' tables (migration 0101), on a session's connection.
//!
//! This operator only stores, finds and removes rows. The rules — which Claims may stand together,
//! when an account is at capacity, how a PIN lapses — are [`super::rules`]'s, and the composite
//! operations that gather facts for them are [`super::service`]'s.

use super::{
    error::AgentError,
    model::{Agent, AgentId, UsageWindow},
    rows::{AgentRow, UsageRow, AGENT_COLUMNS},
};
use crate::access::model::NodeKey;

/// Reads and writes the agents' tables.
///
/// Obtained as `db.agents()`; see [`Db`](crate::database::session::Db) for the borrow rules.
pub struct AgentOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> AgentOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Every Agent, oldest first.
    #[tracing::instrument(skip(self))]
    pub async fn all(&mut self) -> Result<Vec<Agent>, AgentError> {
        let rows: Vec<AgentRow> =
            sqlx::query_as(&format!("SELECT {AGENT_COLUMNS} FROM agents ORDER BY id"))
                .fetch_all(&mut *self.connection)
                .await?;
        rows.into_iter().map(Agent::try_from).collect()
    }

    /// The Agent `id`, if it still exists.
    #[tracing::instrument(skip(self))]
    pub async fn get(&mut self, id: AgentId) -> Result<Option<Agent>, AgentError> {
        let row: Option<AgentRow> =
            sqlx::query_as(&format!("SELECT {AGENT_COLUMNS} FROM agents WHERE id = ?"))
                .bind(id.0)
                .fetch_optional(&mut *self.connection)
                .await?;
        row.map(Agent::try_from).transpose()
    }

    /// The Agent whose token has the digest `sha256`, if any. A child's sub-token is not an agent
    /// token, so it never matches here.
    #[tracing::instrument(skip_all)]
    pub async fn by_token(&mut self, sha256: &str) -> Result<Option<Agent>, AgentError> {
        let row: Option<AgentRow> = sqlx::query_as(&format!(
            "SELECT {AGENT_COLUMNS} FROM agents WHERE token_sha256 = ? AND parent_id IS NULL"
        ))
        .bind(sha256)
        .fetch_optional(&mut *self.connection)
        .await?;
        row.map(Agent::try_from).transpose()
    }

    /// Records a new Agent holding no Claim.
    #[tracing::instrument(skip(self, token_sha256))]
    pub async fn insert(
        &mut self,
        name: &str,
        account: &str,
        session_uuid: &str,
        token_sha256: &str,
        now: &str,
    ) -> Result<AgentId, AgentError> {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO agents (name, account, session_uuid, token_sha256, created_at, \
             last_seen_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(name)
        .bind(account)
        .bind(session_uuid)
        .bind(token_sha256)
        .bind(now)
        .bind(now)
        .fetch_one(&mut *self.connection)
        .await?;
        Ok(AgentId(id))
    }

    /// Records a new child Agent of `parent`, holding no Claim. `client_id` is the client's id for
    /// the subagent; `token_sha256` is its sub-token's digest.
    #[tracing::instrument(skip(self, token_sha256))]
    pub async fn insert_child(
        &mut self,
        parent: AgentId,
        name: &str,
        account: &str,
        client_id: &str,
        token_sha256: &str,
        now: &str,
    ) -> Result<AgentId, AgentError> {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO agents (name, account, session_uuid, token_sha256, created_at, \
             last_seen_at, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(name)
        .bind(account)
        .bind(client_id)
        .bind(token_sha256)
        .bind(now)
        .bind(now)
        .bind(parent.0)
        .fetch_one(&mut *self.connection)
        .await?;
        Ok(AgentId(id))
    }

    /// The child of `parent` registered for the client's subagent `client_id`, if any.
    #[tracing::instrument(skip(self))]
    pub async fn child_by_client(
        &mut self,
        parent: AgentId,
        client_id: &str,
    ) -> Result<Option<Agent>, AgentError> {
        let row: Option<AgentRow> = sqlx::query_as(&format!(
            "SELECT {AGENT_COLUMNS} FROM agents WHERE parent_id = ? AND session_uuid = ?"
        ))
        .bind(parent.0)
        .bind(client_id)
        .fetch_optional(&mut *self.connection)
        .await?;
        row.map(Agent::try_from).transpose()
    }

    /// The child of `parent` whose sub-token has the digest `sha256`, if any.
    #[tracing::instrument(skip_all)]
    pub async fn child_by_token(
        &mut self,
        parent: AgentId,
        sha256: &str,
    ) -> Result<Option<Agent>, AgentError> {
        let row: Option<AgentRow> = sqlx::query_as(&format!(
            "SELECT {AGENT_COLUMNS} FROM agents WHERE parent_id = ? AND token_sha256 = ?"
        ))
        .bind(parent.0)
        .bind(sha256)
        .fetch_optional(&mut *self.connection)
        .await?;
        row.map(Agent::try_from).transpose()
    }

    /// The children of `parent`, oldest first.
    #[tracing::instrument(skip(self))]
    pub async fn children(&mut self, parent: AgentId) -> Result<Vec<Agent>, AgentError> {
        let rows: Vec<AgentRow> = sqlx::query_as(&format!(
            "SELECT {AGENT_COLUMNS} FROM agents WHERE parent_id = ? ORDER BY id"
        ))
        .bind(parent.0)
        .fetch_all(&mut *self.connection)
        .await?;
        rows.into_iter().map(Agent::try_from).collect()
    }

    /// Notes that a session attached with the Agent's token (or just attached it): its session
    /// id as it now stands, and when.
    #[tracing::instrument(skip(self))]
    pub async fn rebind(
        &mut self,
        id: AgentId,
        session_uuid: &str,
        now: &str,
    ) -> Result<(), AgentError> {
        sqlx::query("UPDATE agents SET session_uuid = ?, last_seen_at = ? WHERE id = ?")
            .bind(session_uuid)
            .bind(now)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Notes that the Agent's session was heard from at `now`.
    #[tracing::instrument(skip(self))]
    pub async fn touch(&mut self, id: AgentId, now: &str) -> Result<(), AgentError> {
        sqlx::query("UPDATE agents SET last_seen_at = ? WHERE id = ?")
            .bind(now)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Gives the Agent an active Claim on `root`, made at `now`, replacing any it held.
    #[tracing::instrument(skip(self))]
    pub async fn set_claim(
        &mut self,
        id: AgentId,
        root: NodeKey,
        now: &str,
    ) -> Result<(), AgentError> {
        sqlx::query(
            "UPDATE agents SET claim_kind = ?, claim_id = ?, claim_paused = 0, claimed_at = ? \
             WHERE id = ?",
        )
        .bind(root.node_kind.as_str())
        .bind(root.node_id)
        .bind(now)
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Takes the Agent's Claim away.
    #[tracing::instrument(skip(self))]
    pub async fn clear_claim(&mut self, id: AgentId) -> Result<(), AgentError> {
        sqlx::query(
            "UPDATE agents SET claim_kind = NULL, claim_id = NULL, claim_paused = 0, \
             claimed_at = NULL WHERE id = ?",
        )
        .bind(id.0)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Pauses (`true`) or reactivates (`false`) the Agent's Claim, keeping when it was made.
    #[tracing::instrument(skip(self))]
    pub async fn set_paused(&mut self, id: AgentId, paused: bool) -> Result<(), AgentError> {
        sqlx::query("UPDATE agents SET claim_paused = ? WHERE id = ? AND claim_kind IS NOT NULL")
            .bind(paused)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Locks or unlocks the Agent by hand.
    #[tracing::instrument(skip(self))]
    pub async fn set_locked(&mut self, id: AgentId, locked: bool) -> Result<(), AgentError> {
        sqlx::query("UPDATE agents SET locked = ? WHERE id = ?")
            .bind(locked)
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Removes the Agent. Answers whether there was one.
    #[tracing::instrument(skip(self))]
    pub async fn delete(&mut self, id: AgentId) -> Result<bool, AgentError> {
        let removed = sqlx::query("DELETE FROM agents WHERE id = ?")
            .bind(id.0)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        Ok(removed == 1)
    }

    /// Records a PIN waiting to be used.
    #[tracing::instrument(skip_all)]
    pub async fn insert_pin(
        &mut self,
        pin: &str,
        created_at: &str,
        expires_at: &str,
    ) -> Result<bool, AgentError> {
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO agent_pins (pin, created_at, expires_at) VALUES (?, ?, ?)",
        )
        .bind(pin)
        .bind(created_at)
        .bind(expires_at)
        .execute(&mut *self.connection)
        .await?
        .rows_affected();
        Ok(inserted == 1)
    }

    /// Deletes every PIN that lapsed at or before `now`.
    #[tracing::instrument(skip(self))]
    pub async fn purge_pins(&mut self, now: &str) -> Result<(), AgentError> {
        sqlx::query("DELETE FROM agent_pins WHERE expires_at <= ?")
            .bind(now)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Deletes every PIN: after a run of wrong ones, none is trusted any more.
    #[tracing::instrument(skip(self))]
    pub async fn clear_pins(&mut self) -> Result<(), AgentError> {
        sqlx::query("DELETE FROM agent_pins")
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// How many PINs are waiting to be used.
    #[tracing::instrument(skip(self))]
    pub async fn pending_pins(&mut self) -> Result<usize, AgentError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_pins")
            .fetch_one(&mut *self.connection)
            .await?;
        Ok(usize::try_from(count).unwrap_or(0))
    }

    /// Uses the PIN: deletes it and answers when it lapsed, or `None` for a PIN nobody issued.
    #[tracing::instrument(skip_all)]
    pub async fn take_pin(&mut self, pin: &str) -> Result<Option<String>, AgentError> {
        let expires: Option<String> =
            sqlx::query_scalar("DELETE FROM agent_pins WHERE pin = ? RETURNING expires_at")
                .bind(pin)
                .fetch_optional(&mut *self.connection)
                .await?;
        Ok(expires)
    }

    /// Counts a wrong PIN at `now`.
    #[tracing::instrument(skip(self))]
    pub async fn record_pin_failure(&mut self, now: &str) -> Result<(), AgentError> {
        sqlx::query("INSERT INTO agent_pin_failures (failed_at) VALUES (?)")
            .bind(now)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// When each wrong PIN was presented, forgetting those before `since`.
    #[tracing::instrument(skip(self))]
    pub async fn pin_failures(&mut self, since: &str) -> Result<Vec<String>, AgentError> {
        sqlx::query("DELETE FROM agent_pin_failures WHERE failed_at < ?")
            .bind(since)
            .execute(&mut *self.connection)
            .await?;
        Ok(
            sqlx::query_scalar("SELECT failed_at FROM agent_pin_failures ORDER BY failed_at")
                .fetch_all(&mut *self.connection)
                .await?,
        )
    }

    /// Makes sure the account `label` exists.
    #[tracing::instrument(skip(self))]
    pub async fn ensure_account(&mut self, label: &str) -> Result<(), AgentError> {
        sqlx::query("INSERT OR IGNORE INTO agent_accounts (label) VALUES (?)")
            .bind(label)
            .execute(&mut *self.connection)
            .await?;
        Ok(())
    }

    /// Every account and whether it is locked by hand, by label.
    #[tracing::instrument(skip(self))]
    pub async fn accounts(&mut self) -> Result<Vec<(String, bool)>, AgentError> {
        Ok(
            sqlx::query_as("SELECT label, locked FROM agent_accounts ORDER BY label")
                .fetch_all(&mut *self.connection)
                .await?,
        )
    }

    /// Locks or unlocks the account `label` by hand.
    #[tracing::instrument(skip(self))]
    pub async fn set_account_locked(
        &mut self,
        label: &str,
        locked: bool,
    ) -> Result<(), AgentError> {
        sqlx::query(
            "INSERT INTO agent_accounts (label, locked) VALUES (?, ?) \
             ON CONFLICT (label) DO UPDATE SET locked = excluded.locked",
        )
        .bind(label)
        .bind(locked)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Records the last report of one limit window of an account.
    #[tracing::instrument(skip(self))]
    pub async fn record_usage(
        &mut self,
        account: &str,
        window: &UsageWindow,
        reported_at: &str,
    ) -> Result<(), AgentError> {
        sqlx::query(
            "INSERT INTO agent_account_usage \
             (account, window_kind, percent_used, resets_at, reported_at) VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT (account, window_kind) DO UPDATE SET \
             percent_used = excluded.percent_used, resets_at = excluded.resets_at, \
             reported_at = excluded.reported_at",
        )
        .bind(account)
        .bind(&window.kind)
        .bind(window.percent_used)
        .bind(&window.resets_at)
        .bind(reported_at)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Every account's last reports, by account and window.
    #[tracing::instrument(skip(self))]
    pub async fn usage(&mut self) -> Result<Vec<(String, UsageWindow)>, AgentError> {
        let rows: Vec<UsageRow> = sqlx::query_as(
            "SELECT account, window_kind, percent_used, resets_at FROM agent_account_usage \
             ORDER BY account, window_kind",
        )
        .fetch_all(&mut *self.connection)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Replaces the server's connect token with one whose digest is `sha256`.
    #[tracing::instrument(skip_all)]
    pub async fn set_connect_token(&mut self, sha256: &str, now: &str) -> Result<(), AgentError> {
        sqlx::query(
            "INSERT INTO connect_tokens (id, sha256, created_at) VALUES (1, ?, ?) \
             ON CONFLICT (id) DO UPDATE SET sha256 = excluded.sha256, \
             created_at = excluded.created_at, last_used_at = NULL",
        )
        .bind(sha256)
        .bind(now)
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }

    /// Removes the connect token, so no session can connect until a new one is issued. Answers
    /// whether there was one.
    #[tracing::instrument(skip(self))]
    pub async fn clear_connect_token(&mut self) -> Result<bool, AgentError> {
        let removed = sqlx::query("DELETE FROM connect_tokens")
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        Ok(removed > 0)
    }

    /// Whether `sha256` is the connect token's digest. Records the use when it is.
    #[tracing::instrument(skip_all)]
    pub async fn connect_token_matches(
        &mut self,
        sha256: &str,
        now: &str,
    ) -> Result<bool, AgentError> {
        let used = sqlx::query("UPDATE connect_tokens SET last_used_at = ? WHERE sha256 = ?")
            .bind(now)
            .bind(sha256)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        Ok(used == 1)
    }

    /// When the connect token was issued and last used, if there is one.
    #[tracing::instrument(skip(self))]
    pub async fn connect_token_info(
        &mut self,
    ) -> Result<Option<(String, Option<String>)>, AgentError> {
        Ok(
            sqlx::query_as("SELECT created_at, last_used_at FROM connect_tokens WHERE id = 1")
                .fetch_optional(&mut *self.connection)
                .await?,
        )
    }
}
