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

use tauri::{Manager, Runtime, State, WebviewWindow};

use crate::{
    commands::board::announce,
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
/// It is also where a change **announces itself to the other windows**, when the journal says the
/// Gesture wrote anything at all. This is the command boundary after the commit: the Gesture is
/// over, its transaction has landed, and the journal rows exist. Doing it here rather than at the
/// end of each of the 83 mutating commands is the whole of [`crate::board`]'s argument — a command
/// that wrote nothing to the journal wrote nothing to the board, so no per-command obligation is
/// left to forget.
///
/// The window that issued the command is excluded, because it reloads on the way back from the
/// command itself — which is the path this reuses rather than replacing.
///
/// Fails when nothing is open rather than doing nothing, so that a broken pairing is visible at
/// the call site that broke it instead of at the next gesture, which would be closed early by it.
#[tauri::command]
pub async fn close_gesture<R: Runtime>(
    window: WebviewWindow<R>,
    factory: State<'_, SessionFactory>,
    stacks: State<'_, UndoStacks>,
) -> Result<Option<GestureSummary>, WireError> {
    let closed = engine::close_gesture(&factory, &stacks)
        .await
        .map_err(WireError::from_error)?;
    if closed.wrote {
        announce(window.app_handle(), Some(window.label()));
    }
    Ok(closed.undoable)
}

/// Reverses the most recent user Gesture, and returns what it reversed.
///
/// `None` means the Undo Stack was empty: nothing happened, and that is not an error. An error
/// means the Gesture could **not** be applied and the board is untouched — the whole replay runs
/// in one transaction, so there is no third outcome — and the Gesture stays on the stack, so the
/// same press can be tried again once whatever blocked it is gone.
#[tauri::command]
pub async fn undo<R: Runtime>(
    window: WebviewWindow<R>,
    factory: State<'_, SessionFactory>,
    stacks: State<'_, UndoStacks>,
) -> Result<Option<GestureSummary>, WireError> {
    let applied = engine::undo(&factory, &stacks)
        .await
        .map_err(WireError::from_error)?;
    announce_replay(&window, applied.as_ref());
    Ok(applied)
}

/// Reapplies the most recently undone Gesture, and returns what it reapplied.
///
/// `None` and the error case mean exactly what they do for [`undo`].
#[tauri::command]
pub async fn redo<R: Runtime>(
    window: WebviewWindow<R>,
    factory: State<'_, SessionFactory>,
    stacks: State<'_, UndoStacks>,
) -> Result<Option<GestureSummary>, WireError> {
    let applied = engine::redo(&factory, &stacks)
        .await
        .map_err(WireError::from_error)?;
    announce_replay(&window, applied.as_ref());
    Ok(applied)
}

/// Tells the other windows about an undo or a redo that actually applied.
///
/// A replay is the one write the journal cannot report, because it runs with journalling
/// suppressed — reversing a change must not itself become a change to reverse. So the two commands
/// that make one say so directly. `None` is an empty stack: nothing happened, and nobody is told.
fn announce_replay<R: Runtime>(window: &WebviewWindow<R>, applied: Option<&GestureSummary>) {
    if applied.is_some() {
        announce(window.app_handle(), Some(window.label()));
    }
}

/// What the next undo and the next redo would be, or `None` for each empty stack.
///
/// For labelling and disabling a control. It is not a precondition: [`undo`] and [`redo`] handle
/// an empty stack themselves, so a caller that skips this loses nothing but the label.
#[tauri::command]
pub async fn undo_status(stacks: State<'_, UndoStacks>) -> Result<UndoStatus, WireError> {
    Ok(stacks.status())
}
