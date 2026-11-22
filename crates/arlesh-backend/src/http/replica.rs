//! What a client's Replica needs of the server beyond the Backend port: the device snapshot, the
//! change stream with its source rows, and a way to say why it holds writes (ADR 0017).

use super::{unreachable_error, HttpBackend, ReadOnlyReason, REQUEST_TIMEOUT};
use arlesh_core::error::WireError;

/// The device snapshot's route (`conformance/client-mode.json`).
pub const SNAPSHOT_PATH: &str = "/board/snapshot";

impl HttpBackend {
    /// Fetches the device snapshot: every replicated row with the position it stands at, as the
    /// JSON the server wrote it. The body is returned as text, because the rows' images are
    /// hashed over the exact text they travel as.
    pub async fn device_snapshot(&self) -> Result<String, WireError> {
        let connection = self.connection();
        let response = self
            .http
            .get(format!("{}{SNAPSHOT_PATH}", connection.url))
            .bearer_auth(&connection.token)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(error = %error, "the server could not be reached for a snapshot");
                self.record_failure();
                unreachable_error()
            })?;
        self.set_reachable(true);
        let status = response.status();
        let body = response.text().await.map_err(|error| {
            WireError::internal(format!("could not read the server's snapshot: {error}"))
        })?;
        if !status.is_success() {
            return Err(
                serde_json::from_str::<WireError>(&body).unwrap_or_else(|_| {
                    WireError::internal(format!("the server answered {status} to the snapshot"))
                }),
            );
        }
        Ok(body)
    }

    /// Opens the change stream a Replica follows: events with their source rows, from the latest
    /// one on. It never sends `Last-Event-ID`: a Replica that missed events fetches a snapshot
    /// instead of asking for them again.
    pub async fn open_rows_stream(&self) -> Result<reqwest::Response, WireError> {
        let connection = self.connection();
        let response = self
            .http
            .get(format!("{}{}", connection.url, super::events::CHANGES_PATH))
            .query(&[("rows", "true")])
            .bearer_auth(&connection.token)
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(error = %error, "the change stream could not be opened");
                self.record_failure();
                unreachable_error()
            })?;
        if !response.status().is_success() {
            self.record_failure();
            return Err(WireError::internal(format!(
                "the server answered {} to the change stream",
                response.status()
            )));
        }
        self.set_reachable(true);
        Ok(response)
    }

    /// Says why a Replica holds writes although the server answers, or `None` to let them through.
    pub fn set_hold(&self, hold: Option<ReadOnlyReason>) {
        self.update(|link| link.hold = hold);
    }
}
