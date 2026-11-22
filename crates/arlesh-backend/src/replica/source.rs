//! Where a Replica's board comes from: the server's change stream and device snapshot, behind a
//! trait so the same Replica runs over HTTP in the app and over an in-process server in tests.

use std::sync::Arc;

use arlesh_core::{
    error::WireError,
    replication::{rules::wire, SourceDelta},
};
use serde::Deserialize;
use serde_json::value::RawValue;
use tokio::sync::mpsc;

use crate::http::ReadOnlyReason;
use crate::revision::BoardHead;

/// One `board-changed` event as a Replica reads it: the stamp and origin, and the source rows.
/// The derived `changes` are never read; the Replica derives its own.
#[derive(Debug, Clone)]
pub struct SourceEvent {
    /// The run of the server the event belongs to.
    pub epoch: String,
    /// The writes the event's board holds at least.
    pub revision: u64,
    /// Who made the write the event reports (`agent`, `user`), when the server says.
    pub origin: Option<String>,
    /// The rows that changed, or `None` when the server says they cannot be applied.
    pub source: Option<SourceDelta>,
}

#[derive(Deserialize)]
struct EventIn {
    epoch: String,
    revision: u64,
    #[serde(default)]
    origin: Option<String>,
    #[serde(default)]
    source: Option<Box<RawValue>>,
}

impl SourceEvent {
    /// Reads the data of a `board-changed` event. An event whose `source` cannot be read counts
    /// as one with none, so the Replica fetches a snapshot.
    pub fn parse(data: &str) -> Result<Self, serde_json::Error> {
        let event: EventIn = serde_json::from_str(data)?;
        let source = event
            .source
            .and_then(|raw| match wire::parse_source(raw.get()) {
                Ok(delta) => Some(delta),
                Err(error) => {
                    tracing::warn!(error = %error, "an event's source rows could not be read");
                    None
                }
            });
        Ok(Self {
            epoch: event.epoch,
            revision: event.revision,
            origin: event.origin,
            source,
        })
    }
}

/// What the stream a Replica follows says.
#[derive(Debug, Clone)]
pub enum Incoming {
    /// A `board-changed` event.
    Changed(SourceEvent),
    /// A `board-head` event: where the server's rows stand now.
    Head(BoardHead),
}

/// The server, as a Replica sees it.
#[async_trait::async_trait]
pub trait SyncSource: Send + Sync {
    /// Opens the change stream, from the latest event on. The channel closes when the stream ends
    /// or breaks.
    async fn open(&self) -> Result<mpsc::UnboundedReceiver<Incoming>, WireError>;

    /// Fetches the device snapshot, as the JSON the server wrote it.
    async fn snapshot(&self) -> Result<String, WireError>;

    /// Tells the host why writes are held (`None`: not held), where it keeps the status the
    /// windows show.
    fn hold(&self, reason: Option<ReadOnlyReason>);

    /// Tells the host the stream (and so the server) is gone or back.
    fn reachable(&self, reachable: bool);
}

/// A source that can be shared.
pub type SharedSource = Arc<dyn SyncSource>;
