//! Pairing and the Devices page: the routes of `arlesh-server` that are not the board's, so not
//! methods of the [`Backend`](crate::backend::Backend) port. They are listed under `pairing` in
//! `conformance/client-mode.json`. See `docs/spec/client-mode.md`, *Pairing a device*.
//!
//! [`pair_start`] and [`pair_poll`] are for a device that has no token yet, and so no server to
//! follow: each builds a throwaway client for the URL it was given. The rest are
//! [`HttpBackend`] methods, for a signed-in device.

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::WireError;

use super::{segment, Call, Connection, HttpBackend};

/// What `POST /pair` answers: the PIN to show, and the secret to poll with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairStarted {
    /// The poll's secret. Kept by the device, shown to nobody.
    pub id: String,
    /// Six digits, valid for ten minutes and usable once.
    pub pin: String,
    /// The suggested name as the server reduced it to a client name.
    pub name: String,
    /// When the PIN lapses (the server's local time).
    pub expires_at: String,
}

/// Whether a PIN has been approved yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairStatus {
    /// Not yet approved: poll again.
    Pending,
    /// Approved: the answer carries the token, this once.
    Approved,
}

/// What `POST /pair/poll` answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairPolled {
    /// Pending, or approved.
    pub status: PairStatus,
    /// The name the device holds (approved only).
    pub name: Option<String>,
    /// The device's bearer token (approved only), answered once.
    pub token: Option<String>,
}

/// A device holding a token, as Settings → Devices lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Device {
    /// The device's name, which is its client name.
    pub name: String,
    /// When its token was issued.
    pub created_at: String,
    /// When it last used its token, if the server has seen it since it began to keep that.
    pub last_seen_at: Option<String>,
    /// Whether this is the device asking, which cannot be revoked.
    pub current: bool,
}

/// A device showing a PIN, as the approver sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WaitingDevice {
    /// The PIN.
    pub pin: String,
    /// The name it suggested, which the approver may change.
    pub name: String,
    /// When the PIN lapses.
    pub expires_at: String,
}

/// What approving a PIN answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Approved {
    /// The name the device will hold: the one asked for, suffixed if it was taken.
    pub name: String,
}

/// A client for `url` that sends no token, for the routes open without one.
fn anonymous(url: &str) -> Result<HttpBackend, WireError> {
    HttpBackend::new(Connection::new(url, ""), Arc::new(|_| {}))
}

/// Asks the server at `url` for a PIN for a device that suggests `name`.
pub async fn pair_start(url: &str, name: Option<&str>) -> Result<PairStarted, WireError> {
    anonymous(url)?
        .send(Call::new(Method::POST, "/pair".to_owned()).json(&json!({ "name": name })))
        .await
}

/// Asks the server at `url` whether the PIN of the request `id` names was approved.
pub async fn pair_poll(url: &str, id: &str, pin: &str) -> Result<PairPolled, WireError> {
    anonymous(url)?
        .send(
            Call::new(Method::POST, "/pair/poll".to_owned()).json(&json!({ "id": id, "pin": pin })),
        )
        .await
}

impl HttpBackend {
    /// Every device holding a token.
    pub async fn list_devices(&self) -> Result<Vec<Device>, WireError> {
        self.read(Call::new(Method::GET, "/devices".to_owned()))
            .await
    }

    /// The device waiting with `pin`: the name it suggests.
    pub async fn waiting_device(&self, pin: &str) -> Result<WaitingDevice, WireError> {
        self.read(Call::new(
            Method::GET,
            format!("/pairings/{}", segment(&pin)),
        ))
        .await
    }

    /// Approves the device waiting with `pin`, under `name` (its suggestion if `None`).
    pub async fn approve_device(
        &self,
        pin: &str,
        name: Option<&str>,
    ) -> Result<Approved, WireError> {
        self.write(
            Call::new(Method::POST, format!("/pairings/{}/approve", segment(&pin)))
                .json(&json!({ "name": name })),
        )
        .await
    }

    /// Revokes a device's token. The server refuses the asking device's own.
    pub async fn revoke_device(&self, name: &str) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/devices/{}", segment(&name)),
        ))
        .await
    }
}

#[cfg(test)]
mod tests;
