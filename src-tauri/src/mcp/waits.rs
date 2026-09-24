//! The waits an agent raises: the one write besides issue links.
//!
//! An agent working an Agentic Task that needs something only the user can give — a decision, a
//! credential, an answer — raises an **agentic wait** under that Task instead of stopping in the
//! dark. It is an ordinary Expectation with the agentic flag set and the question in its note, so
//! it shows wherever waits show, and the user answers it the way any wait is answered: by writing
//! the answer into the note and releasing it. See `docs/spec/resources.md`, "Expectations".

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{
    access,
    lookup::{found, Board},
    params::WaitsOperation,
    result,
    result::attempt,
    ArleshMcp,
};
use crate::{
    access::model::AccessLevel, tasks::model::CreateExpectationRequest, undo::model::WriteSource,
};

#[tool_router(router = waits_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Raises an agentic wait — "the agent is waiting on you" — under an Agentic Task you can
    /// write, with your question in `note`.
    ///
    /// Use it when the work needs something only the user can give. The wait is Pending until the
    /// user answers: they write the answer into the note and release it, and both show in the
    /// snapshot's `expectations` (`status: released`, `agentic_note`). A task you are waiting on
    /// is not blocked by it unless the user makes it a dependency.
    ///
    /// `task_id` is a row id or a short id, and may name a Habit occurrence. Needs **write**
    /// access: the task must be an Agentic Task inside an MCP root, or the call is refused as
    /// `not_permitted`.
    #[tool(
        name = "arlesh_waits",
        annotations(
            title = "Arlesh agent waits",
            read_only_hint = false,
            destructive_hint = false
        )
    )]
    pub async fn waits(
        &self,
        Parameters(operation): Parameters<WaitsOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        let WaitsOperation::Ask {
            task_id,
            title,
            note,
        } = operation;

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

        let created = crate::nodes::write::create_expectation(
            &mut db,
            CreateExpectationRequest {
                title,
                parent_type: "task".into(),
                parent_id: task_id,
                agentic: true,
                agentic_note: note,
                ..Default::default()
            },
            now,
        )
        .await;
        let wait = attempt!(created);

        attempt!(db.undo().set_source(user_source).await);
        attempt!(db.commit().await);
        (self.announce)(None);

        result::ok(wait)
    }
}
