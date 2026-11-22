//! [`HttpSource`]: a Replica's [`SyncSource`] over `arlesh-server`.

use std::{sync::Arc, time::Duration};

use arlesh_core::error::WireError;
use tokio::sync::mpsc;

use super::source::{Incoming, SourceEvent, SyncSource};
use crate::http::{events::EventParser, events::BOARD_HEAD, HttpBackend, ReadOnlyReason};

/// How long the stream may say nothing before it is taken for dead (the server sends a head every
/// 15 seconds).
const IDLE_LIMIT: Duration = Duration::from_secs(45);

/// The server over HTTP.
pub struct HttpSource {
    backend: Arc<HttpBackend>,
}

impl HttpSource {
    /// A source over `backend`, which the shell shares with its status and device commands.
    pub fn new(backend: Arc<HttpBackend>) -> Self {
        Self { backend }
    }
}

#[async_trait::async_trait]
impl SyncSource for HttpSource {
    async fn open(&self) -> Result<mpsc::UnboundedReceiver<Incoming>, WireError> {
        let mut response = self.backend.open_rows_stream().await?;
        let (sender, receiver) = mpsc::unbounded_channel();
        let backend = Arc::clone(&self.backend);
        tokio::spawn(async move {
            let mut parser = EventParser::default();
            let mut pending = Vec::new();
            loop {
                let read = match tokio::time::timeout(IDLE_LIMIT, response.chunk()).await {
                    Ok(Ok(Some(chunk))) => chunk,
                    Ok(Ok(None)) => break,
                    Ok(Err(error)) => {
                        tracing::warn!(error = %error, "the change stream dropped");
                        break;
                    }
                    Err(_) => {
                        tracing::warn!("the change stream was silent too long");
                        break;
                    }
                };
                backend.set_reachable(true);
                pending.extend_from_slice(&read);
                for event in parser.feed(&drain_utf8(&mut pending)) {
                    let incoming = match event.name.as_deref() {
                        Some(arlesh_core::board::BOARD_CHANGED) => event
                            .data
                            .as_deref()
                            .and_then(|data| SourceEvent::parse(data).ok())
                            .map(Incoming::Changed),
                        Some(BOARD_HEAD) => event.board_head().map(Incoming::Head),
                        _ => None,
                    };
                    if let Some(incoming) = incoming {
                        if sender.send(incoming).is_err() {
                            return;
                        }
                    }
                }
            }
        });
        Ok(receiver)
    }

    async fn snapshot(&self) -> Result<String, WireError> {
        self.backend.device_snapshot().await
    }

    fn hold(&self, reason: Option<ReadOnlyReason>) {
        self.backend.set_hold(reason);
    }

    fn reachable(&self, reachable: bool) {
        if reachable {
            self.backend.set_reachable(true);
        } else {
            self.backend.record_failure();
        }
    }
}

/// The text of the bytes read so far, leaving a character split across two reads in `pending` to be
/// completed by the next one. Bytes that can never be text are replaced, not waited for.
fn drain_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(text) => {
            let text = text.to_owned();
            pending.clear();
            text
        }
        Err(error) if error.error_len().is_none() => {
            let valid = error.valid_up_to();
            let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
            pending.drain(..valid);
            text
        }
        Err(_) => {
            let text = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            text
        }
    }
}

#[cfg(test)]
mod tests;
