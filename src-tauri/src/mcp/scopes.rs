//! Scope tools.

use chrono::Local;
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{params::ScopesOperation, result, ArleshMcp};
use crate::scopes::{
    error::ScopeError,
    key::ScopeKey,
    resolve::{resolve, ResolvedScope},
};

#[tool_router(router = scopes_router, vis = "pub(super)")]
impl ArleshMcp {
    /// What a scope id does not spell out. A scope id is its value key, a JSON object such as
    /// `{"kind":"week","date":"2026-09-20"}` (the week whose Sunday is the 20th), so the dates are
    /// already in the snapshot.
    ///
    /// `get` returns the scope with its label and inclusive end date; `resolve` its half-open
    /// `[start, end)` datetime window (a day runs 02:00 → 02:00) and whether it is active now.
    /// `resolve_many` resolves a batch positionally against one reference instant. None of them
    /// reads the database.
    #[tool(
        name = "arlesh_scopes",
        annotations(title = "Arlesh scopes", read_only_hint = true)
    )]
    pub async fn scopes(
        &self,
        Parameters(operation): Parameters<ScopesOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        // One clock read for the whole call, so two scopes either side of a boundary cannot
        // disagree about which of them is active.
        let now = Local::now().naive_local();
        match operation {
            ScopesOperation::Get { id } => {
                result::respond(ScopeKey::try_from(id).map(|key| key.scope()))
            }
            ScopesOperation::Resolve { id } => {
                result::respond(ScopeKey::try_from(id).map(|key| resolve(&key, now)))
            }
            ScopesOperation::ResolveMany { ids } => result::respond(
                ids.into_iter()
                    .map(|id| ScopeKey::try_from(id).map(|key| resolve(&key, now)))
                    .collect::<Result<Vec<ResolvedScope>, ScopeError>>(),
            ),
        }
    }
}
