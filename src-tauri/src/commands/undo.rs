//! Tauri commands for the Gesture boundary, and for undo and redo.
//!
//! The backend half of the protocol described in [`crate::undo`]: the frontend says where one
//! thing the user did begins and ends, because it is the only layer that knows that a paste of
//! five nodes is five commands and one Ctrl+Z.
//!
//! Opens nest and join, so the intended shape is a wrapper around `invoke` that opens a Gesture
//! around **every** command, with an explicit outer Gesture around the runs that belong together.
//! A command invoked outside both is journaled and not undoable.
//!
//! [`undo`] and [`redo`] take no arguments and return what they applied, so the caller does not
//! have to track the stacks itself — [`undo_status`] is there to label and disable a control, not
//! to guard the call. Pressing Ctrl+Z with nothing to undo returns `None` and changes nothing.

use tauri::State;

use crate::{
    backend::AppBackend,
    error::WireError,
    undo::model::{GestureId, GestureSummary, UndoStatus},
};

/// Opens a Gesture, or joins the one already open, and returns the Gesture writes now belong to.
///
/// Every call must be matched by a [`close_gesture`].
#[tauri::command]
pub async fn open_gesture(backend: State<'_, AppBackend>) -> Result<GestureId, WireError> {
    backend.open_gesture().await
}

/// Closes one [`open_gesture`]; the Gesture ends when the outermost open is closed.
///
/// Returns what the Gesture amounted to when that close ended it and it changed something the user
/// can undo, and `None` otherwise — a nested close, or a Gesture whose only writes were an agent's
/// or none at all. A Gesture that ends here becomes the next Ctrl+Z and clears the Redo Stack.
///
/// The backend records a write when the journal says the Gesture wrote anything at all, and the
/// board's publisher tells the windows what changed ([`crate::board`]): this is the command
/// boundary after the commit, where the journal rows exist. Doing it here rather than at the end of
/// each of the 83 mutating commands is the whole of that module's argument.
///
/// Fails when nothing is open rather than doing nothing, so that a broken pairing is visible at
/// the call site that broke it instead of at the next gesture, which would be closed early by it.
#[tauri::command]
pub async fn close_gesture(
    backend: State<'_, AppBackend>,
) -> Result<Option<GestureSummary>, WireError> {
    Ok(backend.close_gesture().await?.undoable)
}

/// Closes one [`open_gesture`] and takes back everything the Gesture wrote.
///
/// The all-or-nothing counterpart to [`close_gesture`], for a run of commands that is one thing
/// the user filled in rather than one thing they did to the board — an editor's Save, where a
/// half-applied form is a state nobody asked for. The Gesture reaches neither stack: it is not an
/// undo step, and it does not clear the Redo Stack.
///
/// Returns what it took back, or `None` when the Gesture wrote nothing the user can undo or the
/// close was a nested one. An error means the reversal itself failed, in which case the writes
/// stand and the Gesture has been put on the Undo Stack so the user can still take it back.
///
/// Like [`close_gesture`], the backend records the board's move, and an abort can still move it.
/// The user's writes are taken back, but an agent's write that landed inside the same Gesture was
/// never this Gesture's to reverse. A reversal that **fails** moves it too: the writes stand.
#[tauri::command]
pub async fn abort_gesture(
    backend: State<'_, AppBackend>,
) -> Result<Option<GestureSummary>, WireError> {
    Ok(backend.abort_gesture().await?.taken_back)
}

/// Reverses the most recent user Gesture, and returns what it reversed.
///
/// `None` means the Undo Stack was empty: nothing happened, and that is not an error. An error
/// means the Gesture could **not** be applied and the board is untouched — the whole replay runs
/// in one transaction, so there is no third outcome — and the Gesture stays on the stack, so the
/// same press can be tried again once whatever blocked it is gone.
#[tauri::command]
pub async fn undo(backend: State<'_, AppBackend>) -> Result<Option<GestureSummary>, WireError> {
    backend.undo().await
}

/// Reapplies the most recently undone Gesture, and returns what it reapplied.
///
/// `None` and the error case mean exactly what they do for [`undo`].
#[tauri::command]
pub async fn redo(backend: State<'_, AppBackend>) -> Result<Option<GestureSummary>, WireError> {
    backend.redo().await
}

/// What the next undo and the next redo would be, or `None` for each empty stack.
///
/// For labelling and disabling a control. It is not a precondition: [`undo`] and [`redo`] handle
/// an empty stack themselves, so a caller that skips this loses nothing but the label.
#[tauri::command]
pub async fn undo_status(backend: State<'_, AppBackend>) -> Result<UndoStatus, WireError> {
    backend.undo_status().await
}
