//! [`SqliteBackend`]'s `mindmap` operations: the in-process core over the local file.

use crate::revision::{BoardHead, BoardLoad, BoardRevision, CurrentBoard};
use arlesh_core::{error::WireError, mindmap};

use super::SqliteBackend;
use crate::mindmap::BoardPort;

#[async_trait::async_trait]
impl BoardPort for SqliteBackend {
    async fn load_mindmap(&self, now: chrono::NaiveDateTime) -> Result<BoardLoad, WireError> {
        let mut db = self.factory.begin().await.map_err(WireError::from_error)?;
        let load = mindmap::current(&mut db, now)
            .await
            .map_err(WireError::from_error)?;
        db.commit().await.map_err(WireError::from_error)?;
        // A fresh derive at the asked instant belongs to no publication, so it has no stamp.
        Ok(BoardLoad::unversioned(load))
    }

    async fn current_board(&self) -> Result<CurrentBoard, WireError> {
        let publication = self.publisher.current().await;
        let json = publication
            .json()
            .map_err(|error| WireError::internal(format!("could not write the board: {error}")))?;
        let load = serde_json::value::RawValue::from_string(json.to_string())
            .map_err(|error| WireError::internal(format!("could not write the board: {error}")))?;
        let now = serde_json::to_string(&publication.now)
            .map(|quoted| quoted.trim_matches('"').to_owned())
            .ok();
        Ok(CurrentBoard {
            load,
            revision: Some(BoardRevision {
                epoch: publication.epoch.to_string(),
                revision: publication.revision,
            }),
            seq: Some(publication.seq),
            now,
            hash: Some(publication.hash),
        })
    }

    async fn board_fence(&self) -> Option<BoardRevision> {
        let fence = self.publisher.fence();
        Some(BoardRevision {
            epoch: fence.epoch.to_string(),
            revision: fence.revision,
        })
    }

    async fn board_head(&self) -> Option<BoardHead> {
        self.publisher.head()
    }
}
