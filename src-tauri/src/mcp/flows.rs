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

use super::{
    access,
    lookup::{found, stored_row},
    params::FlowsOperation,
    result,
    result::attempt,
    ArleshMcp,
};
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
    /// Every id is a row id or a short id. A flow or node outside the MCP roots is refused as
    /// `not_permitted`, and an origin in a flow the MCP cannot read is left out.
    #[tool(
        name = "arlesh_flows",
        annotations(title = "Arlesh flows", read_only_hint = true)
    )]
    pub async fn flows(
        &self,
        Parameters(operation): Parameters<FlowsOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        // Transactional only so that a short id can be read against the board; nothing is written.
        let mut db = match self.factory.begin().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };

        let map = attempt!(crate::access::access_map(&mut db).await);

        match operation {
            FlowsOperation::Get { id } => {
                let id = found!(stored_row(&mut db, &id, "flow", self.now()).await);
                if !access::reads(&map, "flow", id) {
                    return access::refuse("flow", id, AccessLevel::Read);
                }
                result::respond(db.flows().get(FlowId(id)).await)
            }
            FlowsOperation::Recurrence { flow_id } => {
                let flow_id = found!(stored_row(&mut db, &flow_id, "flow", self.now()).await);
                if !access::reads(&map, "flow", flow_id) {
                    return access::refuse("flow", flow_id, AccessLevel::Read);
                }
                result::respond(db.flows().get_recurrence(FlowId(flow_id)).await)
            }
            FlowsOperation::CompletionCount { flow_id } => {
                let flow_id = found!(stored_row(&mut db, &flow_id, "flow", self.now()).await);
                if !access::reads(&map, "flow", flow_id) {
                    return access::refuse("flow", flow_id, AccessLevel::Read);
                }
                result::respond(db.flows().habit_completion_count(FlowId(flow_id)).await)
            }
            FlowsOperation::Origins { nodes } => {
                let mut refs: Vec<TargetRef> = Vec::with_capacity(nodes.len());
                for node in nodes {
                    let node_id = found!(
                        stored_row(&mut db, &node.node_id, &node.node_type, self.now()).await
                    );
                    if !access::reads(&map, &node.node_type, node_id) {
                        return access::refuse(&node.node_type, node_id, AccessLevel::Read);
                    }
                    refs.push(TargetRef {
                        node_type: node.node_type,
                        node_id,
                    });
                }
                let origins = attempt!(db.flows().origins(refs).await);
                let mut visible = Vec::with_capacity(origins.len());
                for origin in origins {
                    let flow = attempt!(
                        db.access()
                            .flow_of_instance_node(&origin.node_type, origin.node_id)
                            .await
                    );
                    if flow.is_some_and(|flow_id| access::reads(&map, "flow", flow_id)) {
                        visible.push(origin);
                    }
                }
                result::ok(visible)
            }
        }
    }
}
