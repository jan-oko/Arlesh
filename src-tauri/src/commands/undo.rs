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
    database::session::SessionFactory,
    error::WireError,
    undo::{
        self as engine,
        model::{GestureId, GestureSummary, UndoStatus},
        stacks::UndoStacks,
    },
};

/// Opens a Gesture, or joins the one already open, and returns the Gesture writes now belong to.
///
/// Every call must be matched by a [`close_gesture`].
#[tauri::command]
pub async fn open_gesture(factory: State<'_, SessionFactory>) -> Result<GestureId, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.undo()
        .open_gesture()
        .await
        .map_err(WireError::from_error)
}

/// Closes one [`open_gesture`]; the Gesture ends when the outermost open is closed.
///
/// Returns what the Gesture amounted to when that close ended it and it changed something the user
/// can undo, and `None` otherwise — a nested close, or a Gesture whose only writes were an agent's
/// or none at all. A Gesture that ends here becomes the next Ctrl+Z and clears the Redo Stack.
///
/// Fails when nothing is open rather than doing nothing, so that a broken pairing is visible at
/// the call site that broke it instead of at the next gesture, which would be closed early by it.
#[tauri::command]
pub async fn close_gesture(
    factory: State<'_, SessionFactory>,
    stacks: State<'_, UndoStacks>,
) -> Result<Option<GestureSummary>, WireError> {
    engine::close_gesture(&factory, &stacks)
        .await
        .map_err(WireError::from_error)
}

/// Reverses the most recent user Gesture, and returns what it reversed.
///
/// `None` means the Undo Stack was empty: nothing happened, and that is not an error. An error
/// means the Gesture could **not** be applied and the board is untouched — the whole replay runs
/// in one transaction, so there is no third outcome — and the Gesture stays on the stack, so the
/// same press can be tried again once whatever blocked it is gone.
#[tauri::command]
pub async fn undo(
    factory: State<'_, SessionFactory>,
    stacks: State<'_, UndoStacks>,
) -> Result<Option<GestureSummary>, WireError> {
    engine::undo(&factory, &stacks)
        .await
        .map_err(WireError::from_error)
}

/// Reapplies the most recently undone Gesture, and returns what it reapplied.
///
/// `None` and the error case mean exactly what they do for [`undo`].
#[tauri::command]
pub async fn redo(
    factory: State<'_, SessionFactory>,
    stacks: State<'_, UndoStacks>,
) -> Result<Option<GestureSummary>, WireError> {
    engine::redo(&factory, &stacks)
        .await
        .map_err(WireError::from_error)
}

/// What the next undo and the next redo would be, or `None` for each empty stack.
///
/// For labelling and disabling a control. It is not a precondition: [`undo`] and [`redo`] handle
/// an empty stack themselves, so a caller that skips this loses nothing but the label.
#[tauri::command]
pub async fn undo_status(stacks: State<'_, UndoStacks>) -> Result<UndoStatus, WireError> {
    Ok(stacks.status())
}
