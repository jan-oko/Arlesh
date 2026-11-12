//! The notes an agent writes: an Info node under the Agentic Task it is working.
//!
//! An agent that shortens a long Task title keeps the full wording in an Info under the Task, and
//! an agent may leave any other note there the same way. Creating is the whole surface — an agent
//! neither edits nor deletes an Info. See `docs/spec/mcp-server.md`, "Notes".

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use serde_json::{json, Value};
use std::collections::HashMap;

use super::{
    access, ids::NodeNames, lookup::found, params::InfosOperation, result, result::attempt,
    ArleshMcp,
};
use crate::{
    access::model::{AccessLevel, NodeTable},
    infos::model::{CreateInfoRequest, Info},
    mindmap::model::MindmapLoad,
    nodes::id::NodeId,
    undo::model::WriteSource,
};

/// The Infos hanging directly under the Task `task`, in board order.
///
/// `load` is a board already cut to what the MCP may see, so a private Info, or one outside the
/// roots, is not among them. Infos under the Task's sub-items are not either.
pub(super) fn directly_under<'load>(load: &'load MindmapLoad, task: &NodeId) -> Vec<&'load Info> {
    let mut found: Vec<&Info> = load
        .infos
        .iter()
        .filter(|info| info.parent_type == "task" && &info.parent_id == task)
        .collect();
    found.sort_by_key(|info| (info.position, info.id));
    found
}

/// How many Infos hang directly under each Task of `load`, by Task id; a Task with none is absent.
pub(super) fn counts_by_task(load: &MindmapLoad) -> HashMap<NodeId, usize> {
    let mut counts = HashMap::new();
    for info in load.infos.iter().filter(|info| info.parent_type == "task") {
        *counts.entry(info.parent_id.clone()).or_insert(0) += 1;
    }
    counts
}

/// Infos as `arlesh_tasks.get` returns them: ids, `body` and `details`.
pub(super) fn as_read(infos: &[&Info], names: &NodeNames) -> Value {
    infos
        .iter()
        .map(|info| {
            names.stamped(
                json!({ "id": info.id, "body": info.body, "details": info.details }),
                NodeTable::Info,
            )
        })
        .collect()
}

#[tool_router(router = infos_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Notes an agent writes under an Agentic Task it can write.
    ///
    /// `create` hangs a new Info (a note node) under the Task: `body` is its one-line text — its
    /// title — and `details` optional longer text beneath it. Use it, for instance, to keep a long
    /// Task title's full wording when you shorten the title with `arlesh_tasks.update`. The Info
    /// comes back as the snapshot's `infos` carry it, with its `id`, `short_id` and `full_id`.
    /// Infos cannot be edited or deleted over the MCP.
    ///
    /// The Task is a row id or a short id. A Task you cannot write — outside the MCP roots, or not
    /// reading as Agentic — is refused as `not_permitted`; a blank `body` as `invalid_request`.
    #[tool(
        name = "arlesh_infos",
        annotations(
            title = "Arlesh notes",
            read_only_hint = false,
            destructive_hint = false
        )
    )]
    pub async fn infos(
        &self,
        Parameters(operation): Parameters<InfosOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        let InfosOperation::Create {
            task_id,
            body,
            details,
        } = operation;
        if body.trim().is_empty() {
            return result::refused("an Info needs a non-blank body");
        }

        // Transactional and tagged: the access check and the write see one board, and only these
        // statements are journaled as the agent's. The Undo Journal's ambient source is one row
        // shared by every connection, so holding SQLite's writer lock from setting it to restoring
        // it — a transaction — is what makes "the source is mcp" true for exactly these statements.
        let mut db = match self.factory.begin().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };
        let now = self.now();
        let board = attempt!(self.board(&mut db, now).await);

        let task_id = found!(board.resolve(&task_id, "task"));
        if !attempt!(board.writes_task(&mut db, &task_id, now).await) {
            return access::refuse("task", &task_id, AccessLevel::Write);
        }
        let user_source = attempt!(db.undo().set_source(WriteSource::Mcp).await);

        let created = crate::nodes::write::create_info(
            &mut db,
            CreateInfoRequest {
                body,
                details,
                parent_type: "task".into(),
                parent_id: task_id,
                // Last among the Task's children, as a row the backend inserts is placed.
                position: crate::tasks::insertion_position(),
            },
            now,
        )
        .await;
        let info = attempt!(created);

        attempt!(db.undo().set_source(user_source).await);
        attempt!(db.commit().await);
        (self.announce)(None);

        result::ok(board.names.stamped(info, NodeTable::Info))
    }
}
