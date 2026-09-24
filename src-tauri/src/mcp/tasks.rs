//! Task tools — the reads the snapshot does not answer.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{access, params::TasksOperation, result, ArleshMcp};
use crate::{
    access::model::AccessLevel,
    tasks::model::{TaskId, TimeScope},
};

#[tool_router(router = tasks_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Per-task reads that `arlesh_snapshot` does not cover.
    ///
    /// `get` returns a task together with its block reasons — both the explicit ones and those
    /// implied by its unmet dependencies, which the snapshot gives you only as raw edges.
    /// `containment_conflicts` asks which descendants would violate the containment invariant if a
    /// node were given a particular window; it is a what-if and changes nothing.
    ///
    /// Both name a node, and a node outside the MCP roots is refused as `not_permitted`. What
    /// comes back is cut to the roots: tags, block reasons and descendants the MCP cannot see are
    /// left out.
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

        let map = match crate::access::access_map(&mut db).await {
            Ok(map) => map,
            Err(error) => return result::failed(error),
        };

        match operation {
            TasksOperation::Get { id } => {
                if !access::reads(&map, "task", id) {
                    return access::refuse("task", id, AccessLevel::Read);
                }
                let mut found =
                    match crate::tasks::get_task_with_blockers(&mut db, TaskId(id)).await {
                        Ok(found) => found,
                        Err(error) => return result::failed(error),
                    };
                let dependencies = match db.tasks().list_dependencies(TaskId(id)).await {
                    Ok(dependencies) => dependencies,
                    Err(error) => return result::failed(error),
                };
                access::restrict_task(&mut found.task, &map);
                access::restrict_block_reasons(&mut found.block_reasons, &dependencies, &map);
                result::ok(found)
            }
            TasksOperation::ContainmentConflicts { node, time_scope } => {
                if !access::reads(&map, &node.node_type, node.node_id) {
                    return access::refuse(&node.node_type, node.node_id, AccessLevel::Read);
                }
                let window: TimeScope = time_scope.into();
                match crate::tasks::conflicts_for_new_time_scope(
                    &mut db,
                    &node.node_type,
                    node.node_id,
                    &window,
                )
                .await
                {
                    Ok(mut conflicts) => {
                        conflicts.retain(|descendant| {
                            access::reads(&map, &descendant.node_type, descendant.node_id)
                        });
                        result::ok(conflicts)
                    }
                    Err(error) => result::failed(error),
                }
            }
        }
    }
}
