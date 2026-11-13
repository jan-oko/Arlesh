//! Following the server's change stream (`GET /events/changes`): live sync between devices.
//!
//! Each `board-changed` event the server sends is relayed through `announce` — the shell wires it
//! to the same Tauri event a Standalone write raises — with its changed nodes as the server wrote
//! them, so a window updates its board from the event alone (ADR 0020). A `board-head` event is
//! kept as the backend's head, which a window compares its board with.
//! The stream is reconnected for as long as the app runs, with `Last-Event-ID`, and the server
//! replays the events this device missed while it was away. The id is kept across a suspend and a
//! resume, so a phone that comes back to the front is caught up instead of reloading.

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use super::HttpBackend;
use crate::revision::{BoardChange, BoardHead};

/// What the shell is told for each `board-changed`: the event, with its changes as raw JSON.
pub type Announce = Arc<dyn Fn(BoardChange) + Send + Sync>;

/// The id of the last event heard, kept by the [`Follower`] across reconnects, suspends and
/// resumes.
type LastEventId = Arc<Mutex<Option<String>>>;

/// The name of the event that carries the latest publication's head.
pub const BOARD_HEAD: &str = "board-head";

/// The change stream's route on the server (`conformance/client-mode.json`, `streams`).
pub const CHANGES_PATH: &str = "/events/changes";

/// The longest wait between two reconnects.
const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// How long the stream may say nothing before it is taken for dead. The server sends a `board-head`
/// every 15 seconds, so this is three of them missed: a connection that has silently gone (the
/// phone changed network) is dropped and made again rather than waited on for ever.
const IDLE_LIMIT: Duration = Duration::from_secs(45);

/// One parsed Server-Sent Event: its id, its name and its data.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Event {
    /// The event's `id:` line, if it had one.
    pub id: Option<String>,
    /// The event's `event:` line, if it had one.
    pub name: Option<String>,
    /// The event's `data:` lines, joined by newlines, if it had any.
    pub data: Option<String>,
}

impl Event {
    /// A `board-changed` event as the windows are told it, or `None` when its data cannot be read.
    pub fn board_change(&self) -> Option<BoardChange> {
        BoardChange::parse(self.data.as_deref()?).ok()
    }

    /// A `board-head` event's head, or `None` when its data cannot be read.
    pub fn board_head(&self) -> Option<BoardHead> {
        serde_json::from_str(self.data.as_deref()?).ok()
    }
}

/// Splits a Server-Sent Events stream into events as its bytes arrive. Comments are dropped.
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
                if event.name.is_some() || event.id.is_some() || event.data.is_some() {
                    events.push(event);
                }
                continue;
            }
            if let Some(id) = line.strip_prefix("id:") {
                self.event.id = Some(id.trim_start().to_owned());
            } else if let Some(name) = line.strip_prefix("event:") {
                self.event.name = Some(name.trim_start().to_owned());
            } else if let Some(data) = line.strip_prefix("data:") {
                let data = data.strip_prefix(' ').unwrap_or(data);
                match self.event.data.as_mut() {
                    Some(joined) => {
                        joined.push('\n');
                        joined.push_str(data);
                    }
                    None => self.event.data = Some(data.to_owned()),
                }
            }
        }
        events
    }
}

/// The change stream, followed only while the app is in front.
///
/// A phone suspends the app when it goes to the background, and a connection held through that is
/// one the system kills anyway. So the stream is dropped on [`suspend`](Self::suspend) and opened
/// afresh on [`resume`](Self::resume), which checks `/health` again and asks the server for the
/// events missed while the app was away (the last event id is kept across the gap), so the windows
/// are caught up rather than reloaded. A desktop never suspends, and so follows from the start to
/// the end of the run.
pub struct Follower {
    backend: Arc<HttpBackend>,
    announce: Announce,
    runtime: tokio::runtime::Handle,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    last_event_id: LastEventId,
}

impl Follower {
    /// A follower of `backend`'s stream, not yet following. It runs on `runtime`: [`resume`](Self::resume)
    /// is called from a window event handler, outside any runtime, where a bare `tokio::spawn`
    /// would panic.
    pub fn new(
        backend: Arc<HttpBackend>,
        announce: Announce,
        runtime: tokio::runtime::Handle,
    ) -> Self {
        Self {
            backend,
            announce,
            runtime,
            task: Mutex::new(None),
            last_event_id: Arc::new(Mutex::new(None)),
        }
    }

    /// Starts following, unless it already is.
    pub fn resume(&self) {
        let mut task = self.lock();
        if task.is_some() {
            return;
        }
        let backend = Arc::clone(&self.backend);
        let announce = Arc::clone(&self.announce);
        let last_event_id = Arc::clone(&self.last_event_id);
        *task = Some(self.runtime.spawn(follow(backend, announce, last_event_id)));
    }

    /// Drops the connection and stops reconnecting, until [`resume`](Self::resume).
    pub fn suspend(&self) {
        if let Some(task) = self.lock().take() {
            task.abort();
        }
    }

    /// Whether the stream is being followed now.
    pub fn is_following(&self) -> bool {
        self.lock().is_some()
    }

    fn lock(&self) -> MutexGuard<'_, Option<tokio::task::JoinHandle<()>>> {
        self.task
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Follows the change stream until the process ends, calling `announce` for every
/// `board-changed` and resuming from `last_event_id`. Reconnects after any failure, waiting longer each time up to
/// [`MAX_BACKOFF`], and checks `/health` again on each reconnect. A dropped stream is a failed
/// attempt, not yet an outage: the server is shown as unreachable only after
/// [`super::FAILURES_BEFORE_UNREACHABLE`] in a row.
pub async fn follow(backend: Arc<HttpBackend>, announce: Announce, last_event_id: LastEventId) {
    let mut backoff = Duration::from_secs(1);
    loop {
        let mut connected = false;
        match stream_once(&backend, &announce, &last_event_id, &mut connected).await {
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
    announce: &Announce,
    last_event_id: &LastEventId,
    connected: &mut bool,
) -> Result<(), String> {
    let connection = backend.connection();
    let mut request = backend
        .http
        .get(format!("{}{CHANGES_PATH}", connection.url))
        .bearer_auth(&connection.token);
    let resume_from = last_event_id
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    if let Some(id) = resume_from {
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
                last_event_id
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .clone_from(&event.id);
            }
            match event.name.as_deref() {
                Some(arlesh_core::board::BOARD_CHANGED) => relay(backend, announce, &event),
                Some(BOARD_HEAD) => {
                    if let Some(head) = event.board_head() {
                        backend.set_head(head);
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

/// Passes a `board-changed` event on to the windows. One whose data cannot be read is passed on
/// as a reload, so a window never misses a change silently.
fn relay(backend: &HttpBackend, announce: &Announce, event: &Event) {
    let change = event.board_change().unwrap_or_else(|| {
        tracing::warn!("a board-changed event could not be read; its windows will reload");
        BoardChange {
            epoch: String::new(),
            seq: None,
            revision: 0,
            now: None,
            hash: None,
            changes: None,
            reload: true,
        }
    });
    backend.note_change(&change);
    announce(change);
}

#[cfg(test)]
mod tests;
