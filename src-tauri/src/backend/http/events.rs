//! Following the server's change stream (`GET /events`): live sync between devices.
//!
//! Each `board-changed` event the server sends is relayed through `announce` — the shell wires it
//! to the same Tauri event a Standalone write raises — so every window reloads as it always has.
//! The stream is reconnected for as long as the app runs, with `Last-Event-ID`, and the server
//! sends one event at once when this device missed anything while it was away.

use std::sync::Arc;
use std::time::Duration;

use super::HttpBackend;

/// The longest wait between two reconnects.
const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// How long the stream may say nothing before it is taken for dead. The server sends a comment
/// every 15 seconds, so this is three of them missed: a connection that has silently gone (the
/// phone changed network) is dropped and made again rather than waited on for ever.
const IDLE_LIMIT: Duration = Duration::from_secs(45);

/// One parsed Server-Sent Event: its id and its name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Event {
    /// The event's `id:` line, if it had one.
    pub id: Option<String>,
    /// The event's `event:` line, if it had one.
    pub name: Option<String>,
}

/// Splits a Server-Sent Events stream into events as its bytes arrive. Comments and `data:` lines
/// are dropped: an event's name is all the app needs.
#[derive(Debug, Default)]
pub struct EventParser {
    pending: String,
    event: Event,
}

impl EventParser {
    /// Feeds `chunk` in and answers every event it completed.
    pub fn feed(&mut self, chunk: &str) -> Vec<Event> {
        self.pending.push_str(chunk);
        let mut events = Vec::new();
        while let Some(end) = self.pending.find('\n') {
            let line: String = self.pending.drain(..=end).collect();
            let line = line.trim_end_matches(['\n', '\r']);
            if line.is_empty() {
                let event = std::mem::take(&mut self.event);
                if event.name.is_some() || event.id.is_some() {
                    events.push(event);
                }
                continue;
            }
            if let Some(id) = line.strip_prefix("id:") {
                self.event.id = Some(id.trim_start().to_owned());
            } else if let Some(name) = line.strip_prefix("event:") {
                self.event.name = Some(name.trim_start().to_owned());
            }
        }
        events
    }
}

/// Follows the change stream until the process ends, calling `announce` for every
/// `board-changed`. Reconnects after any failure, waiting longer each time up to
/// [`MAX_BACKOFF`], and checks `/health` again on each reconnect. A dropped stream is a failed
/// attempt, not yet an outage: the server is shown as unreachable only after
/// [`super::FAILURES_BEFORE_UNREACHABLE`] in a row.
pub async fn follow(backend: Arc<HttpBackend>, announce: Arc<dyn Fn() + Send + Sync>) {
    let mut last_event_id: Option<String> = None;
    let mut backoff = Duration::from_secs(1);
    loop {
        let mut connected = false;
        match stream_once(&backend, &announce, &mut last_event_id, &mut connected).await {
            Ok(()) => tracing::info!("the change stream ended; reconnecting"),
            Err(error) => {
                tracing::warn!(error = %error, "the change stream dropped");
                backend.record_failure();
            }
        }
        // A stream that was up has earned a quick retry; one that never connected backs off.
        if connected {
            backoff = Duration::from_secs(1);
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

async fn stream_once(
    backend: &HttpBackend,
    announce: &Arc<dyn Fn() + Send + Sync>,
    last_event_id: &mut Option<String>,
    connected: &mut bool,
) -> Result<(), String> {
    let connection = backend.connection();
    let mut request = backend
        .http
        .get(format!("{}/events", connection.url))
        .bearer_auth(&connection.token);
    if let Some(id) = last_event_id.as_deref() {
        request = request.header("Last-Event-ID", id);
    }
    let mut response = tokio::time::timeout(IDLE_LIMIT, request.send())
        .await
        .map_err(|_| "the server did not answer the stream".to_owned())?
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("the server answered {}", response.status()));
    }
    backend.set_reachable(true);
    *connected = true;
    // A reconnect is also when the server may have been replaced by another version.
    if let Err(error) = backend.check_health().await {
        tracing::warn!(error = ?error, "the server's /health did not answer");
    }
    let mut parser = EventParser::default();
    loop {
        let read = tokio::time::timeout(IDLE_LIMIT, response.chunk())
            .await
            .map_err(|_| format!("the stream was silent for {} seconds", IDLE_LIMIT.as_secs()))?;
        let Some(chunk) = read.map_err(|error| error.to_string())? else {
            break;
        };
        // Whatever the stream sends, keepalive comments included, proves the server is there.
        backend.set_reachable(true);
        for event in parser.feed(&String::from_utf8_lossy(&chunk)) {
            if event.id.is_some() {
                last_event_id.clone_from(&event.id);
            }
            if event.name.as_deref() == Some(crate::board::BOARD_CHANGED) {
                announce();
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
