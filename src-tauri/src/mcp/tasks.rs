//! Task tools — the reads the snapshot does not answer.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{params::TasksOperation, result, ArleshMcp};
use crate::tasks::model::{TaskId, TimeScope};

#[tool_router(router = tasks_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Per-task reads that `arlesh_snapshot` does not cover.
    ///
    /// `get` returns a task together with its block reasons — both the explicit ones and those
    /// implied by its unmet dependencies, which the snapshot gives you only as raw edges.
    /// `containment_conflicts` asks which descendants would violate the containment invariant if a
    /// node were given a particular window; it is a what-if and changes nothing.
    #[tool(
        name = "arlesh_tasks",
        annotations(title = "Arlesh tasks", read_only_hint = true)
    )]
    pub async fn tasks(
        &self,
        Parameters(operation): Parameters<TasksOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        let mut db = match self.factory.connect().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };

        match operation {
            TasksOperation::Get { id } => {
                result::respond(crate::tasks::get_task_with_blockers(&mut db, TaskId(id)).await)
            }
            TasksOperation::ContainmentConflicts { node, time_scope } => {
                let window = match TimeScope::try_from(time_scope) {
                    Ok(window) => window,
                    Err(error) => return result::failed(error),
                };
                result::respond(
                    crate::tasks::conflicts_for_new_time_scope(
                        &mut db,
                        &node.node_type,
                        node.node_id,
                        &window,
                    )
                    .await,
                )
            }
        }
    }
}
