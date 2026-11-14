//! [`SqliteBackend`]'s Gesture and undo operations: the engine over the local file.

use super::SqliteBackend;
use crate::undo::UndoPort;
use arlesh_core::{
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
        let closed = engine::close_gesture(&self.factory, &self.stacks)
            .await
            .map_err(WireError::from_error)?;
        if closed.wrote {
            self.publisher.record_write();
        }
        Ok(closed)
    }

    async fn abort_gesture(&self) -> Result<GestureAbort, WireError> {
        match engine::abort_gesture(&self.factory, &self.stacks).await {
            Ok(aborted) => {
                if aborted.wrote {
                    self.publisher.record_write();
                }
                Ok(aborted)
            }
            Err(error) => {
                // The reversal failed, so everything the Gesture wrote is still on the board.
                self.publisher.record_write();
                Err(WireError::from_error(error))
            }
        }
    }

    async fn undo(&self) -> Result<Option<GestureSummary>, WireError> {
        let applied = engine::undo(&self.factory, &self.stacks)
            .await
            .map_err(WireError::from_error)?;
        if applied.is_some() {
            self.publisher.record_write();
        }
        Ok(applied)
    }

    async fn redo(&self) -> Result<Option<GestureSummary>, WireError> {
        let applied = engine::redo(&self.factory, &self.stacks)
            .await
            .map_err(WireError::from_error)?;
        if applied.is_some() {
            self.publisher.record_write();
        }
        Ok(applied)
    }

    async fn undo_status(&self) -> Result<UndoStatus, WireError> {
        Ok(self.stacks.status())
    }
}
