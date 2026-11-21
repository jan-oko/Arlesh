//! The press timing log: where the time of one press went, so a number can be read off a real
//! phone (`adb logcat -s arlesh::press`, or the app log).
//!
//! One `tracing` line on target `arlesh::press` per press, with the queue wait, the local write
//! and the publisher's read, derive, diff, serialize and emit; the window adds its own
//! `ipc_apply_ms` through the shell's `report_press_timing` command.

use std::{
    sync::Arc,
    time::Duration,
};

use arlesh_core::mindmap::publisher::TurnTimings;

use super::sync::Shared;
use crate::sqlite::SqliteBackend;

/// How many presses are kept for reading back.
const KEPT: usize = 100;

/// Where the time of one press went.
#[derive(Debug, Clone, Copy)]
pub struct PressTiming {
    /// The publication the press made.
    pub seq: u64,
    /// From the caller's ask to the Replica starting on it.
    pub queue_wait: Duration,
    /// The write on the Replica.
    pub write: Duration,
    /// The publisher's turn.
    pub turn: TurnTimings,
}

/// Tells the local board a write landed and, once it has published, records where the time went.
pub(super) fn announce(
    shared: &Arc<Shared>,
    local: &Arc<SqliteBackend>,
    queue_wait: Duration,
    write: Duration,
) {
    let publisher = local.publisher().clone();
    let before = publisher.head().map_or(0, |head| head.seq);
    local.record_write();
    let shared = Arc::clone(shared);
    tokio::spawn(async move {
        let events = publisher.after(before, Duration::from_secs(10)).await;
        let Some(seq) = events.last().map(|event| event.seq) else {
            return;
        };
        let Some(turn) = publisher.timings_of(seq) else {
            return;
        };
        let timing = PressTiming {
            seq,
            queue_wait,
            write,
            turn,
        };
        tracing::info!(
            target: "arlesh::press",
            seq,
            queue_wait_ms = queue_wait.as_millis() as u64,
            write_ms = write.as_millis() as u64,
            read_ms = turn.read.as_millis() as u64,
            derive_ms = turn.derive.as_millis() as u64,
            diff_ms = turn.diff.as_millis() as u64,
            serialize_ms = turn.serialize.as_millis() as u64,
            emit_ms = turn.emit.as_millis() as u64,
            "press"
        );
        let mut kept = shared
            .presses
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if kept.len() == KEPT {
            kept.pop_front();
        }
        kept.push_back(timing);
    });
}
