//! The whole-graph snapshot tool.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{params::SnapshotOperation, result, ArleshMcp};
use crate::error::AppError;

#[tool_router(router = snapshot_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Arlesh's whole planning graph in one call: domains, goals, tasks, infos, flows, flow items,
    /// cycles, dependencies, block reasons, materialised instance nodes, each item's derived
    /// lifecycle, and each flow's habit iterations and statuses.
    ///
    /// Start here. Tasks and goals carry `time_scope` and `plan` as boundary scope IDs rather than
    /// dates — resolve them with `arlesh_scopes.resolve_many`.
    ///
    /// Not read-only: deriving habit iterations materialises the scope rows their windows land on.
    /// It creates no tasks, goals or flows.
    #[tool(
        name = "arlesh_snapshot",
        annotations(title = "Arlesh snapshot", read_only_hint = false, destructive_hint = false)
    )]
    pub async fn snapshot(
        &self,
        Parameters(operation): Parameters<SnapshotOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        let SnapshotOperation::Load { now } = operation;

        // Transactional and committed, matching `commands::mindmap::load_mindmap`: without the
        // commit sqlx discards the derived scopes on drop and still returns a correct-looking
        // payload, whose habit iterations then name scope ids that no longer exist.
        let mut db = match self.factory.begin().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };

        let load = match crate::mindmap::load(&mut db, now).await {
            Ok(load) => load,
            Err(error) => return result::failed(error),
        };

        if let Err(error) = db.commit().await {
            return result::failed(error);
        }

        result::respond(Ok::<_, AppError>(load))
    }
}
