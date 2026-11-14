//! The Tauri command for the mindmap's whole-tree load.

use tauri::State;

use crate::backend::AppBackend;
use crate::{backend::revision::CurrentBoard, error::WireError};

/// The latest published board, as the window takes it in the first time, after a gap in the
/// events, after a new run of the producer, after a hash mismatch, and when it falls back.
///
/// The board is the core's own JSON, passed on as it was written: the window's board hash is taken
/// over that text. It carries the publication it is (`seq`, `revision`, `now`, `hash`), so the
/// window knows which events are news. It derives nothing: the producer's publisher derived it
/// after the last write, or at the last minute's tick. What the board says about each node beyond
/// its row, and the blocks of the agents at capacity, are in it as in any board
/// ([`crate::mindmap::rules::facts`], [`crate::capacity::blocks`]).
///
/// A device that wants a board at an instant of its choosing asks the backend's
/// `load_mindmap(now)`, as scripts and tests do; no window does.
#[tauri::command]
pub async fn load_mindmap(backend: State<'_, AppBackend>) -> Result<CurrentBoard, WireError> {
    backend.current_board().await
}
