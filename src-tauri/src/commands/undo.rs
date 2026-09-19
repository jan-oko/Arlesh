//! Tauri commands for the Gesture boundary.
//!
//! The backend half of the protocol described in [`crate::undo`]: the frontend says where one
//! thing the user did begins and ends, because it is the only layer that knows that a paste of
//! five nodes is five commands and one Ctrl+Z.
//!
//! Opens nest and join, so the intended shape is a wrapper around `invoke` that opens a Gesture
//! around **every** command, with an explicit outer Gesture around the runs that belong together.
//! A command invoked outside both is journaled and not undoable.

use tauri::State;

use crate::{database::session::SessionFactory, error::WireError, undo::model::GestureId};

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
/// Fails when nothing is open rather than doing nothing, so that a broken pairing is visible at
/// the call site that broke it instead of at the next gesture, which would be closed early by it.
#[tauri::command]
pub async fn close_gesture(factory: State<'_, SessionFactory>) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.undo()
        .close_gesture()
        .await
        .map_err(WireError::from_error)
}
