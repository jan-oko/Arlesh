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

use super::{
    access,
    lookup::{found, Board},
    params::InfosOperation,
    result,
    result::attempt,
    ArleshMcp,
};
use crate::{
    access::model::{AccessLevel, NodeTable},
    infos::model::CreateInfoRequest,
    undo::model::WriteSource,
};

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

        // Transactional and tagged, for the reasons `beads` gives: the access check and the write
        // see one board, and only these statements are journaled as the agent's.
        let mut db = match self.factory.begin().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };
        let now = self.now();
        let board = attempt!(Board::read(&mut db, now).await);

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
