//! Which board a copy of it is: the server's **revision** and **epoch**.
//!
//! The server counts every committed write (the *revision*) within one run of itself (the
//! *epoch*), and says both on `GET /board` and in each `board-changed` event (`docs/spec/http-api.md`,
//! *Revision*). A window that holds the board with its stamp can tell, from an event's stamp
//! alone, whether the event is news (`src/stores/board-revision-store.ts`). Standalone has no
//! server and no stamp: its loads carry none, and a window with none reloads on every event, as it
//! always has.

use std::ops::{Deref, DerefMut};

use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};

use crate::mindmap::model::MindmapLoad;

/// The header the server puts the revision in.
pub const REVISION_HEADER: &str = "x-arlesh-revision";
/// The header the server puts the epoch in.
pub const EPOCH_HEADER: &str = "x-arlesh-epoch";

/// A point in the server's history of the board: how many writes it had committed, in one run of
/// the server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardRevision {
    /// Names the run of the server this revision counts in; it starts again at 0 on a restart.
    pub epoch: String,
    /// How many writes the board had committed.
    pub revision: u64,
}

impl BoardRevision {
    /// The stamp on a server's answer, or `None` when it carries none (an older server, or a
    /// proxy that stripped it).
    pub fn from_headers(headers: &HeaderMap) -> Option<Self> {
        let revision = headers.get(REVISION_HEADER)?.to_str().ok()?.parse().ok()?;
        let epoch = headers.get(EPOCH_HEADER)?.to_str().ok()?.to_owned();
        Some(Self { epoch, revision })
    }
}

/// The board as one window loads it, with the revision it was read at when the backend knows one.
///
/// On the wire it is the [`MindmapLoad`] with one more field, `revision`, left off when absent. It
/// dereferences to the load, so what reads the rows reads them as before.
#[derive(Debug, Clone, Default, Serialize)]
pub struct BoardLoad {
    #[serde(flatten)]
    load: MindmapLoad,
    /// The revision the board was read at: `Some` in Client mode, `None` in Standalone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<BoardRevision>,
}

impl BoardLoad {
    /// A load the backend can say nothing of the revision of.
    pub fn unversioned(load: MindmapLoad) -> Self {
        Self {
            load,
            revision: None,
        }
    }

    /// A load read at `revision`.
    pub fn at(load: MindmapLoad, revision: Option<BoardRevision>) -> Self {
        Self { load, revision }
    }

    /// The load, without its revision.
    pub fn into_load(self) -> MindmapLoad {
        self.load
    }
}

impl Deref for BoardLoad {
    type Target = MindmapLoad;

    fn deref(&self) -> &MindmapLoad {
        &self.load
    }
}

impl DerefMut for BoardLoad {
    fn deref_mut(&mut self) -> &mut MindmapLoad {
        &mut self.load
    }
}

#[cfg(test)]
mod tests;
