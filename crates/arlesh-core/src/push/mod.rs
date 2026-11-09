//! Phone push notifications: which devices are registered, and what each has been told
//! (migration 0099). The rules live in [`rules`]; this module gathers what they need.
//!
//! The tables are the server's own, like `server_tokens`: the desktop app never reads them and
//! they are not journaled ([`crate::undo::EXCLUDED_TABLES`]). See `docs/spec/notifications.md`.

pub mod model;
pub mod rules;

use chrono::NaiveDateTime;

use crate::{
    database::session::{Db, Transactional},
    error::AppError,
    mindmap::{self, model::MindmapLoad},
};

use model::{DevicePlan, PushDevice, SentEntry};

#[derive(sqlx::FromRow)]
struct DeviceRow {
    client: String,
    fcm_token: String,
}

impl From<DeviceRow> for PushDevice {
    fn from(row: DeviceRow) -> Self {
        Self {
            client: row.client,
            fcm_token: row.fcm_token,
        }
    }
}

#[derive(sqlx::FromRow)]
struct SentRow {
    key: String,
    value: String,
}

impl From<SentRow> for SentEntry {
    fn from(row: SentRow) -> Self {
        Self {
            key: row.key,
            value: row.value,
        }
    }
}

/// Reads and writes the registered devices and what they were told, on a session's connection.
///
/// Obtained as `db.push()`; see [`Db`](crate::database::session::Db) for the borrow rules.
pub struct PushOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> PushOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Registers `client`'s FCM token, replacing the one it had. Another device holding the same
    /// token is dropped: a token belongs to one device. Answers whether `client` is new.
    #[tracing::instrument(skip(self, fcm_token))]
    pub async fn register(
        &mut self,
        client: &str,
        fcm_token: &str,
        registered_at: &str,
    ) -> Result<bool, sqlx::Error> {
        let known: Option<String> =
            sqlx::query_scalar("SELECT client FROM push_devices WHERE client = ?")
                .bind(client)
                .fetch_optional(&mut *self.connection)
                .await?;
        let stale: Vec<String> = sqlx::query_scalar(
            "SELECT client FROM push_devices WHERE fcm_token = ? AND client != ?",
        )
        .bind(fcm_token)
        .bind(client)
        .fetch_all(&mut *self.connection)
        .await?;
        for other in stale {
            self.unregister(&other).await?;
        }
        sqlx::query(
            "INSERT INTO push_devices (client, fcm_token, registered_at) VALUES (?, ?, ?) \
             ON CONFLICT(client) DO UPDATE SET fcm_token = excluded.fcm_token",
        )
        .bind(client)
        .bind(fcm_token)
        .bind(registered_at)
        .execute(&mut *self.connection)
        .await?;
        Ok(known.is_none())
    }

    /// Removes `client`'s registration and its record of what it was told. Answers `false` when it
    /// had none.
    #[tracing::instrument(skip(self))]
    pub async fn unregister(&mut self, client: &str) -> Result<bool, sqlx::Error> {
        sqlx::query("DELETE FROM push_sent WHERE client = ?")
            .bind(client)
            .execute(&mut *self.connection)
            .await?;
        let removed = sqlx::query("DELETE FROM push_devices WHERE client = ?")
            .bind(client)
            .execute(&mut *self.connection)
            .await?
            .rows_affected();
        Ok(removed == 1)
    }

    /// Every registered device, by name.
    #[tracing::instrument(skip(self))]
    pub async fn devices(&mut self) -> Result<Vec<PushDevice>, sqlx::Error> {
        let rows: Vec<DeviceRow> =
            sqlx::query_as("SELECT client, fcm_token FROM push_devices ORDER BY client")
                .fetch_all(&mut *self.connection)
                .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// What `client` has been told.
    #[tracing::instrument(skip(self))]
    pub async fn sent(&mut self, client: &str) -> Result<Vec<SentEntry>, sqlx::Error> {
        let rows: Vec<SentRow> =
            sqlx::query_as("SELECT key, value FROM push_sent WHERE client = ? ORDER BY key")
                .bind(client)
                .fetch_all(&mut *self.connection)
                .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Records that `client` was told `entries`, replacing what a key held.
    #[tracing::instrument(skip(self, entries))]
    pub async fn record(
        &mut self,
        client: &str,
        entries: &[SentEntry],
        sent_at: &str,
    ) -> Result<(), sqlx::Error> {
        for entry in entries {
            sqlx::query(
                "INSERT INTO push_sent (client, key, value, sent_at) VALUES (?, ?, ?, ?) \
                 ON CONFLICT(client, key) DO UPDATE SET value = excluded.value, \
                 sent_at = excluded.sent_at",
            )
            .bind(client)
            .bind(&entry.key)
            .bind(&entry.value)
            .bind(sent_at)
            .execute(&mut *self.connection)
            .await?;
        }
        Ok(())
    }

    /// Forgets that `client` was told `keys`.
    #[tracing::instrument(skip(self, keys))]
    pub async fn forget(&mut self, client: &str, keys: &[String]) -> Result<(), sqlx::Error> {
        for key in keys {
            sqlx::query("DELETE FROM push_sent WHERE client = ? AND key = ?")
                .bind(client)
                .bind(key)
                .execute(&mut *self.connection)
                .await?;
        }
        Ok(())
    }
}

/// The board at `now`, with the Agentic Tasks of the agents at capacity blocked, and whether any
/// agent is at capacity: the one fact a device is told about capacity.
async fn board_at_capacity(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
) -> Result<(MindmapLoad, bool), AppError> {
    let blocking = crate::agents::service::blocking(db, now).await?;
    let at_capacity = !blocking.is_none();
    Ok((mindmap::board(db, now, blocking).await?, at_capacity))
}

/// Registers `client` for push, and answers whether it was new. A new device is taken to have been
/// told everything true on the board at `now`, so it hears only of what happens after it
/// registers; a known one (a token rotated, the app restarted) keeps its record, and so is still
/// owed what happened while it was away.
#[tracing::instrument(skip(db, fcm_token))]
pub async fn register_device(
    db: &mut Db<Transactional>,
    client: &str,
    fcm_token: &str,
    now: NaiveDateTime,
) -> Result<bool, AppError> {
    let stamp = now.to_string();
    let new = db.push().register(client, fcm_token, &stamp).await?;
    if new {
        let (load, at_capacity) = board_at_capacity(db, now).await?;
        let baseline = rules::baseline(&rules::observe(&load, at_capacity));
        db.push().record(client, &baseline, &stamp).await?;
    }
    Ok(new)
}

/// What every registered device is to be sent now, from one derivation of the board at `now`.
/// What a device was told that no longer holds is forgotten here; what is sent is recorded by the
/// caller, with [`PushOperator::record`], once the push service has accepted it.
#[tracing::instrument(skip(db))]
pub async fn plan_all(
    db: &mut Db<Transactional>,
    now: NaiveDateTime,
) -> Result<Vec<DevicePlan>, AppError> {
    let devices = db.push().devices().await?;
    if devices.is_empty() {
        return Ok(Vec::new());
    }
    let (load, at_capacity) = board_at_capacity(db, now).await?;
    let observed = rules::observe(&load, at_capacity);
    let mut plans = Vec::new();
    for device in devices {
        let sent = db.push().sent(&device.client).await?;
        let plan = rules::plan(&observed, &sent);
        db.push().forget(&device.client, &plan.forget).await?;
        if !plan.send.is_empty() {
            plans.push(DevicePlan {
                device,
                events: plan.send,
            });
        }
    }
    Ok(plans)
}

#[cfg(test)]
mod tests;
