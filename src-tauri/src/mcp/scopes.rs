//! Scope resolution tools.

use chrono::Local;
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{params::ScopesOperation, result, ArleshMcp};
use crate::scopes::{
    model::ScopeId,
    resolve::{resolve, ResolvedScope},
};

#[tool_router(router = scopes_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Turns the scope IDs carried by tasks and goals into concrete dates.
    ///
    /// `get` returns the stored scope row; `resolve` adds its half-open `[start, end)` datetime
    /// window and whether it is currently active. `resolve_many` resolves a batch positionally —
    /// use it after a snapshot rather than resolving one ID at a time.
    #[tool(
        name = "arlesh_scopes",
        annotations(title = "Arlesh scopes", read_only_hint = true)
    )]
    pub async fn scopes(
        &self,
        Parameters(operation): Parameters<ScopesOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        let mut db = match self.factory.connect().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };

        match operation {
            ScopesOperation::Get { id } => result::respond(db.scopes().get(ScopeId(id)).await),
            ScopesOperation::Resolve { id } => {
                let now = Local::now().naive_local();
                match db.scopes().get(ScopeId(id)).await {
                    Ok(scope) => result::respond(resolve(&scope, now)),
                    Err(error) => result::failed(error),
                }
            }
            ScopesOperation::ResolveMany { ids } => {
                // One clock read for the whole batch, so two scopes either side of a boundary
                // cannot disagree about which of them is active.
                let now = Local::now().naive_local();
                let mut resolved: Vec<ResolvedScope> = Vec::with_capacity(ids.len());
                for id in ids {
                    let scope = match db.scopes().get(ScopeId(id)).await {
                        Ok(scope) => scope,
                        Err(error) => return result::failed(error),
                    };
                    match resolve(&scope, now) {
                        Ok(value) => resolved.push(value),
                        Err(error) => return result::failed(error),
                    }
                }
                result::respond(Ok::<_, crate::scopes::error::ScopeError>(resolved))
            }
        }
    }
}
