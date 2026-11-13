//! [`HttpBackend`]'s `mindmap` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::revision::{
    BoardHead, BoardLoad, BoardRevision, CurrentBoard, BOARD_NOW_HEADER, HASH_HEADER, SEQ_HEADER,
};
use arlesh_core::error::WireError;
use serde_json::value::RawValue;

use super::{device_now, is_unknown_route, is_unreachable, Call, HttpBackend};
use crate::mindmap::BoardPort;
use reqwest::{header::HeaderMap, Method};

#[async_trait::async_trait]
impl BoardPort for HttpBackend {
    async fn load_mindmap(&self, now: chrono::NaiveDateTime) -> Result<BoardLoad, WireError> {
        self.load_board(Call::new(Method::GET, "/board".to_owned()).query("now", &now))
            .await
    }

    async fn current_board(&self) -> Result<CurrentBoard, WireError> {
        let call = Call::new(Method::GET, "/board/current".to_owned());
        match self.send_with_headers::<Box<RawValue>>(call).await {
            Ok((load, headers)) => {
                let current = published(load, &headers);
                self.keep_current(&current);
                Ok(current)
            }
            Err(error) if is_unknown_route(&error) => self.current_board_from_board().await,
            Err(error) if is_unreachable(&error) => self.kept_current().ok_or(error),
            Err(error) => Err(error),
        }
    }

    async fn board_fence(&self) -> Option<BoardRevision> {
        self.fence()
    }

    async fn board_head(&self) -> Option<BoardHead> {
        self.head()
    }
}

impl HttpBackend {
    /// An older server has no `/board/current`: its board is derived afresh at this device's
    /// clock and carries no sequence number or hash, so every event reloads it.
    async fn current_board_from_board(&self) -> Result<CurrentBoard, WireError> {
        let board = self.load_mindmap(device_now()).await?;
        let load = serde_json::value::to_raw_value(&*board)
            .map_err(|error| WireError::internal(format!("could not write the board: {error}")))?;
        let current = CurrentBoard {
            load,
            revision: board.revision.clone(),
            seq: None,
            now: None,
            hash: None,
        };
        self.keep_current(&current);
        Ok(current)
    }
}

/// A published board with what its headers say of it.
fn published(load: Box<RawValue>, headers: &HeaderMap) -> CurrentBoard {
    let text = |name: &str| headers.get(name)?.to_str().ok();
    CurrentBoard {
        load,
        revision: BoardRevision::from_headers(headers),
        seq: text(SEQ_HEADER).and_then(|seq| seq.parse().ok()),
        now: text(BOARD_NOW_HEADER).map(str::to_owned),
        hash: text(HASH_HEADER).and_then(|hash| hash.parse().ok()),
    }
}
