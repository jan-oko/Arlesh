//! [`HttpBackend`]'s `access` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::{
    access::model::{EffectiveAccess, NodeTable},
    error::WireError,
};

use super::{segment, Call, HttpBackend};
use crate::access::model::McpAccessCatalogue;
use crate::backend::access::AccessPort;
use reqwest::Method;

#[async_trait::async_trait]
impl AccessPort for HttpBackend {
    async fn mcp_access_catalogue(&self) -> Result<McpAccessCatalogue, WireError> {
        self.read(Call::new(Method::GET, "/mcp-access/catalogue".to_owned()))
            .await
    }

    async fn list_mcp_access(&self) -> Result<Vec<EffectiveAccess>, WireError> {
        self.read(Call::new(Method::GET, "/mcp-access".to_owned()))
            .await
    }

    async fn add_mcp_root(&self, node_kind: NodeTable, node_id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::PUT,
            format!(
                "/mcp-access/roots/{}/{}",
                segment(&node_kind),
                segment(&node_id)
            ),
        ))
        .await
    }

    async fn remove_mcp_root(&self, node_kind: NodeTable, node_id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!(
                "/mcp-access/roots/{}/{}",
                segment(&node_kind),
                segment(&node_id)
            ),
        ))
        .await
    }
}
