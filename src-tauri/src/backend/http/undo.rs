//! [`HttpBackend`]'s Gestures and undo, for now.
//!
//! How a Gesture crosses HTTP — a paste of five nodes is five requests and one Ctrl+Z — is an open
//! design question on Task 9f0 (Arlesh wait `dd2`). Until it is settled the device keeps its own
//! Gesture nesting, so the frontend's protocol still pairs up, and undo and redo are refused as not
//! available in Client mode yet. Nothing is journaled differently on the server meanwhile: each
//! write is journaled under this device's client, outside any Gesture.

use super::{not_in_client_mode, HttpBackend};
use crate::{
    backend::undo::UndoPort,
    error::WireError,
    undo::{
        model::{GestureId, GestureSummary, UndoStatus},
        GestureAbort, GestureClose,
    },
};

/// What the refusals name.
const UNDO: &str = "Undo";

impl HttpBackend {
    fn nesting(&self) -> std::sync::MutexGuard<'_, u32> {
        self.gestures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[async_trait::async_trait]
impl UndoPort for HttpBackend {
    async fn open_gesture(&self) -> Result<GestureId, WireError> {
        *self.nesting() += 1;
        Ok(GestureId("client-mode".to_owned()))
    }

    async fn close_gesture(&self) -> Result<GestureClose, WireError> {
        close_one(&mut self.nesting())?;
        // The other windows hear of the write from the server's change stream, so nothing here
        // has to say the board moved.
        Ok(GestureClose::default())
    }

    async fn abort_gesture(&self) -> Result<GestureAbort, WireError> {
        close_one(&mut self.nesting())?;
        Ok(GestureAbort::default())
    }

    async fn undo(&self) -> Result<Option<GestureSummary>, WireError> {
        Err(not_in_client_mode(UNDO))
    }

    async fn redo(&self) -> Result<Option<GestureSummary>, WireError> {
        Err(not_in_client_mode(UNDO))
    }

    async fn undo_status(&self) -> Result<UndoStatus, WireError> {
        Ok(UndoStatus {
            undo: None,
            redo: None,
        })
    }
}

/// Closes one open Gesture, failing when none is open, as the local engine does.
fn close_one(depth: &mut u32) -> Result<(), WireError> {
    if *depth == 0 {
        return Err(WireError::invalid_request("no Gesture is open"));
    }
    *depth -= 1;
    Ok(())
}
