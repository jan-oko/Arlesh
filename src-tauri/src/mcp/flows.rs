//! Flow tools — the reads the snapshot does not answer.
//!
//! `valid_targets` is deliberately absent. It writes (resolving a concrete window mints the
//! canonical scopes it names, which is why `commands::flows::scope_valid_flow_targets` opens a
//! transaction), and it answers "where could this flow be started?" — a question no tool here can
//! act on while `start_flow` is out of scope. It belongs with the write surface, not ahead of it.

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{params::FlowsOperation, result, ArleshMcp};
use crate::flows::model::{FlowId, TargetRef};

#[tool_router(router = flows_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Flow reads that `arlesh_snapshot` does not cover.
    ///
    /// `recurrence` returns a Habit's stored configuration — the repetition and consumption rules
    /// — as opposed to the iterations the snapshot derives from it, and is `null` for a flow that
    /// is not a Habit. `origins` maps materialised nodes back to the flow they were started from.
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

        match operation {
            FlowsOperation::Get { id } => result::respond(db.flows().get(FlowId(id)).await),
            FlowsOperation::Recurrence { flow_id } => {
                result::respond(db.flows().get_recurrence(FlowId(flow_id)).await)
            }
            FlowsOperation::CompletionCount { flow_id } => {
                result::respond(db.flows().habit_completion_count(FlowId(flow_id)).await)
            }
            FlowsOperation::Origins { nodes } => {
                let refs: Vec<TargetRef> = nodes.into_iter().map(Into::into).collect();
                result::respond(db.flows().origins(refs).await)
            }
        }
    }
}
