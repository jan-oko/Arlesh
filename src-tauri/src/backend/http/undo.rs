//! [`HttpBackend`]'s Gestures, undo and redo.
//!
//! A Gesture never crosses a request (`docs/spec/client-mode.md`, *Undo*): the server makes every
//! write request one Gesture of this device's client, and a gesture over several nodes is one of
//! the gesture operations. So the frontend's opens and closes only pair up here, on the device, and
//! nothing is sent for them. Undo and redo are the server's, on this device's own stacks.

use reqwest::Method;

use super::{Call, HttpBackend};
use crate::{
    backend::undo::UndoPort,
    error::WireError,
    undo::{
        model::{GestureId, GestureSummary, UndoStatus},
        GestureAbort, GestureClose,
    },
};

/// The id the device's local Gestures answer with: they have no row of their own on the server.
const LOCAL_GESTURE: &str = "client-mode";

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
        Ok(GestureId(LOCAL_GESTURE.to_owned()))
    }

    async fn close_gesture(&self) -> Result<GestureClose, WireError> {
        close_one(&mut self.nesting())?;
        // Each write was already its own step on the server, and the other windows hear of it
        // from the server's change stream, so the close has nothing to report.
        Ok(GestureClose::default())
    }

    async fn abort_gesture(&self) -> Result<GestureAbort, WireError> {
        // An editor's all-or-nothing Save is one gesture operation, refused whole by the server;
        // there is nothing on the device to take back.
        close_one(&mut self.nesting())?;
        Ok(GestureAbort::default())
    }

    async fn undo(&self) -> Result<Option<GestureSummary>, WireError> {
        self.write(Call::new(Method::POST, "/undo".to_owned()))
            .await
    }

    async fn redo(&self) -> Result<Option<GestureSummary>, WireError> {
        self.write(Call::new(Method::POST, "/redo".to_owned()))
            .await
    }

    async fn undo_status(&self) -> Result<UndoStatus, WireError> {
        self.read(Call::new(Method::GET, "/undo".to_owned())).await
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
