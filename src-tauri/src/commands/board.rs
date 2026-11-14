//! Tauri's side of the board's changes: telling the windows, and the three calls a window makes
//! to keep its board true (ADR 0020).
//!
//! The decision of *what* changed is not here: the core's publisher derives the board after every
//! committed write, compares it with the one before and makes a change event (Standalone), or the
//! server does and the follower relays it (Client mode). Either way the event reaches every
//! window, the one that wrote included, because no window reloads after its own write any more:
//! it applies the event like any other. This file is the one place that turns an event into the
//! Tauri `board-changed` event, and the commands a window asks the backend through.

use serde::Deserialize;
use tauri::{Emitter, Runtime, State, WebviewWindow};

use crate::backend::{
    revision::{BoardChange, BoardHead, BoardRevision},
    AppBackend,
};
use crate::board::BOARD_CHANGED;
use crate::error::WireError;

/// Tells every window that the board changed, with what changed.
///
/// Best-effort: a window that cannot be reached is logged and the others still hear. A failure to
/// announce must never turn into a failure of the write that caused it; the board has already
/// changed, and a window that missed the event finds the gap at the next one or at its next check
/// of the head, and loads the board whole.
pub fn emit_board_change<R: Runtime>(app: &tauri::AppHandle<R>, change: &BoardChange) {
    if let Err(error) = app.emit(BOARD_CHANGED, change) {
        tracing::warn!(error = %error, "could not tell the windows the board changed");
    }
}

/// The [`Sink`](crate::mindmap::publisher::Sink) of Standalone's publisher: each change event
/// becomes the windows' `board-changed`.
pub fn board_change_sink<R: Runtime>(app: &tauri::AppHandle<R>) -> crate::mindmap::publisher::Sink {
    let app = app.clone();
    std::sync::Arc::new(move |event| match BoardChange::from_event(event) {
        Ok(change) => emit_board_change(&app, &change),
        Err(error) => tracing::error!(error = %error, "a change event could not be read"),
    })
}

/// The newest revision a write is known to have reached: what a window settles on after its own.
#[tauri::command]
pub async fn board_fence(
    backend: State<'_, AppBackend>,
) -> Result<Option<BoardRevision>, WireError> {
    Ok(backend.board_fence().await)
}

/// The latest publication's identity, for a window to check its board against.
#[tauri::command]
pub async fn board_head(backend: State<'_, AppBackend>) -> Result<Option<BoardHead>, WireError> {
    Ok(backend.board_head().await)
}

/// What a window found when its board disagreed with the producer's.
#[derive(Debug, Deserialize)]
pub struct DivergenceReport {
    /// How the disagreement was found: `event`, `head`, `recompute` or `load`.
    pub found_by: String,
    /// The run both sides name.
    pub epoch: String,
    /// The publication the window holds.
    pub window_seq: Option<u64>,
    /// The publication the producer says is the latest.
    pub head_seq: Option<u64>,
    /// The window's board hash.
    pub window_hash: u32,
    /// The hash the producer says.
    pub head_hash: u32,
    /// The collections whose sums differ.
    pub collections: Vec<String>,
}

/// Writes a board divergence, a bug, to the app's log. Answers nothing: the window reloads.
#[tauri::command]
pub fn report_board_divergence<R: Runtime>(window: WebviewWindow<R>, report: DivergenceReport) {
    tracing::error!(
        window = window.label(),
        found_by = %report.found_by,
        epoch = %report.epoch,
        window_seq = ?report.window_seq,
        head_seq = ?report.head_seq,
        window_hash = report.window_hash,
        head_hash = report.head_hash,
        collections = ?report.collections,
        "board divergence"
    );
}
