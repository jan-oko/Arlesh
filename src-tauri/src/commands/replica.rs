//! What the shell tells the windows about the Replica (Client mode, ADR 0017): writes that were
//! taken back, and what a press cost.

use arlesh_backend::replica::queue::{DropReason, Dropped, OnDropped};
use serde::Serialize;
use tauri::{Emitter, Runtime};

/// The event a window turns into one notice: some writes were not made.
pub const REPLICA_DROPPED: &str = "replica-dropped";

/// What the notice says.
#[derive(Serialize, Clone)]
struct DroppedPayload {
    count: usize,
    reason: &'static str,
}

/// A callback for the Replica that emits [`REPLICA_DROPPED`] to every window.
pub fn dropped_notifier<R: Runtime>(app: &tauri::AppHandle<R>) -> OnDropped {
    let app = app.clone();
    std::sync::Arc::new(move |dropped: Dropped| {
        let reason = match dropped.reason {
            DropReason::Refused => "refused",
            DropReason::Unreachable => "unreachable",
        };
        let payload = DroppedPayload {
            count: dropped.count,
            reason,
        };
        if let Err(error) = app.emit(REPLICA_DROPPED, payload) {
            tracing::warn!(error = %error, "could not tell the windows writes were taken back");
        }
    })
}

/// What a window reports of a press: how long from the board event reaching it to its store
/// holding the change. Joins the Rust side's `arlesh::press` line in the app log, so one phone
/// build can be read end to end.
#[tauri::command]
pub fn report_press_timing(seq: u64, ipc_apply_ms: u64) {
    tracing::info!(target: "arlesh::press", seq, ipc_apply_ms, "press applied in the window");
}
