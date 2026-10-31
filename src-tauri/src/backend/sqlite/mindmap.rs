//! [`SqliteBackend`]'s `mindmap` operations: the in-process core over the local file.

use crate::{error::WireError, mindmap, mindmap::model::MindmapLoad};

use super::SqliteBackend;
use crate::backend::mindmap::BoardPort;

#[async_trait::async_trait]
impl BoardPort for SqliteBackend {
    async fn load_mindmap(&self, now: chrono::NaiveDateTime) -> Result<MindmapLoad, WireError> {
        let at_capacity = self.capacity.get().await.at_capacity;
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let load = mindmap::board(&mut db, now, at_capacity)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        Ok(load)
    }
}
