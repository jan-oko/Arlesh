//! [`HttpBackend`]'s `mindmap` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::{error::WireError, mindmap::model::MindmapLoad};

use super::{Call, HttpBackend};
use crate::backend::mindmap::BoardPort;
use reqwest::Method;

#[async_trait::async_trait]
impl BoardPort for HttpBackend {
    async fn load_mindmap(&self, now: chrono::NaiveDateTime) -> Result<MindmapLoad, WireError> {
        self.load_board(Call::new(Method::GET, "/board".to_owned()).query("now", &now))
            .await
    }
}
