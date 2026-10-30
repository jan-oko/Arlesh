//! [`SqliteBackend`]'s Gesture and undo operations: the engine over the local file.

use super::SqliteBackend;
use crate::{
    backend::undo::UndoPort,
    error::WireError,
    undo::{
        self as engine,
        model::{GestureId, GestureSummary, UndoStatus},
        GestureAbort, GestureClose,
    },
};

#[async_trait::async_trait]
impl UndoPort for SqliteBackend {
    async fn open_gesture(&self) -> Result<GestureId, WireError> {
        let mut db = self
            .factory
            .connect()
            .await
            .map_err(WireError::from_error)?;
        db.undo()
            .open_gesture()
            .await
            .map_err(WireError::from_error)
    }

    async fn close_gesture(&self) -> Result<GestureClose, WireError> {
        engine::close_gesture(&self.factory, &self.stacks)
            .await
            .map_err(WireError::from_error)
    }

    async fn abort_gesture(&self) -> Result<GestureAbort, WireError> {
        engine::abort_gesture(&self.factory, &self.stacks)
            .await
            .map_err(WireError::from_error)
    }

    async fn undo(&self) -> Result<Option<GestureSummary>, WireError> {
        engine::undo(&self.factory, &self.stacks)
            .await
            .map_err(WireError::from_error)
    }

    async fn redo(&self) -> Result<Option<GestureSummary>, WireError> {
        engine::redo(&self.factory, &self.stacks)
            .await
            .map_err(WireError::from_error)
    }

    async fn undo_status(&self) -> Result<UndoStatus, WireError> {
        Ok(self.stacks.status())
    }
}
