//! [`HttpBackend`]'s `block_reasons` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::{block_reasons::model::BlockReason, error::WireError};

use super::{segment, Call, HttpBackend};
use crate::backend::block_reasons::BlockReasonsPort;
use reqwest::Method;

#[async_trait::async_trait]
impl BlockReasonsPort for HttpBackend {
    async fn list_all_block_reasons(&self) -> Result<Vec<BlockReason>, WireError> {
        self.read(Call::new(Method::GET, "/board/block-reasons".to_owned()))
            .await
    }

    async fn set_block_reasons(
        &self,
        owner_type: String,
        owner_id: crate::nodes::id::NodeId,
        reasons: Vec<String>,
    ) -> Result<(), WireError> {
        self.write(
            Call::new(
                Method::PUT,
                format!(
                    "/nodes/{}/{}/block-reasons",
                    segment(&owner_type),
                    segment(&owner_id)
                ),
            )
            .json(&reasons),
        )
        .await
    }
}
