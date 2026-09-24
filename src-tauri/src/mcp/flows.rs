//! Flow tools — the reads the snapshot does not answer.
//!
//! `valid_targets` is deliberately absent. It only reads, but it answers "where could this flow be
//! started?" — a question no tool here can act on while `start_flow` is out of scope. It belongs
//! with the write surface, not ahead of it.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{access, params::FlowsOperation, result, ArleshMcp};
use crate::{
    access::model::AccessLevel,
    flows::model::{FlowId, TargetRef},
};

#[tool_router(router = flows_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Flow reads that `arlesh_snapshot` does not cover.
    ///
    /// `recurrence` returns a Habit's stored configuration — the repetition and consumption rules
    /// — as opposed to the iterations the snapshot derives from it, and is `null` for a flow that
    /// is not a Habit. `origins` maps materialised nodes back to the flow they were started from.
    ///
    /// A flow or node outside the MCP roots is refused as `not_permitted`, and an origin
    /// in a flow the MCP cannot read is left out.
    #[tool(
        name = "arlesh_flows",
        annotations(title = "Arlesh flows", read_only_hint = true)
    )]
    pub async fn flows(
        &self,
        Parameters(operation): Parameters<FlowsOperation>,
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
            FlowsOperation::Get { id } => {
                if !access::reads(&map, "flow", id) {
                    return access::refuse("flow", id, AccessLevel::Read);
                }
                result::respond(db.flows().get(FlowId(id)).await)
            }
            FlowsOperation::Recurrence { flow_id } => {
                if !access::reads(&map, "flow", flow_id) {
                    return access::refuse("flow", flow_id, AccessLevel::Read);
                }
                result::respond(db.flows().get_recurrence(FlowId(flow_id)).await)
            }
            FlowsOperation::CompletionCount { flow_id } => {
                if !access::reads(&map, "flow", flow_id) {
                    return access::refuse("flow", flow_id, AccessLevel::Read);
                }
                result::respond(db.flows().habit_completion_count(FlowId(flow_id)).await)
            }
            FlowsOperation::Origins { nodes } => {
                if let Some(hidden) = nodes
                    .iter()
                    .find(|node| !access::reads(&map, &node.node_type, node.node_id))
                {
                    return access::refuse(&hidden.node_type, hidden.node_id, AccessLevel::Read);
                }
                let refs: Vec<TargetRef> = nodes.into_iter().map(Into::into).collect();
                let origins = match db.flows().origins(refs).await {
                    Ok(origins) => origins,
                    Err(error) => return result::failed(error),
                };
                let mut visible = Vec::with_capacity(origins.len());
                for origin in origins {
                    let flow = match db
                        .access()
                        .flow_of_instance_node(&origin.node_type, origin.node_id)
                        .await
                    {
                        Ok(flow) => flow,
                        Err(error) => return result::failed(error),
                    };
                    if flow.is_some_and(|flow_id| access::reads(&map, "flow", flow_id)) {
                        visible.push(origin);
                    }
                }
                result::ok(visible)
            }
        }
    }
}
