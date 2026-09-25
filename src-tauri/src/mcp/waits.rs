//! The waits an agent raises, releases and watches.
//!
//! An agent working an Agentic Task that needs something it cannot get itself raises an **agentic
//! wait** under that Task instead of stopping in the dark. It is an ordinary Expectation with the
//! agentic flag set, so it shows wherever waits show. A **question** wait asks the user — "the
//! agent is waiting on you" — and is released only with an **answer**: the user's, written in the
//! app, or one the agent got from the user in its own session. A wait that is not a question waits
//! on something non-human, like CI, and the agent releases it when that is done. See
//! `docs/spec/resources.md`, "Expectations".

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};

use super::{
    access,
    lookup::{found, Answer, Board},
    params::{NodeIdParam, WaitsOperation},
    result,
    result::attempt,
    ArleshMcp,
};
use crate::{
    access::model::{AccessLevel, NodeTable},
    nodes::id::NodeId,
    tasks::model::{
        CreateExpectationRequest, Expectation, ExpectationStatus, UpdateExpectationRequest,
    },
    undo::model::WriteSource,
};

#[tool_router(router = waits_router, vis = "pub(super)")]
impl ArleshMcp {
    /// The waits an agent raises under an Agentic Task it can write, releases and watches.
    ///
    /// `raise` hangs a wait under the Task: a **question** for the user (`question: true`, the
    /// default — "the agent is waiting on you") or, with `question: false`, a wait on something
    /// non-human, like CI. `ask` is `raise` as a question. The note carries the question, or what
    /// is being waited on.
    ///
    /// `release` releases an agentic wait under a Task you can write. A question wait needs an
    /// `answer` — ask the user yourself if you can, and record what they said — and is refused
    /// without one; a non-question wait needs none. The user can release either from the app, a
    /// question only with an answer too.
    ///
    /// `get` returns one wait as the snapshot's `expectations` carry it — `status`, `question`,
    /// `agentic_note`, `answer` — so you can poll for the user's answer without the snapshot.
    ///
    /// Ids are row ids or short ids. A Task you cannot write, or a wait under one, is refused as
    /// `not_permitted`; `get` needs only that you can see the wait.
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
        // Transactional and tagged, for the reasons `beads` gives: the access check and the write
        // see one board, and only these statements are journaled as the agent's.
        let mut db = match self.factory.begin().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };
        let now = self.now();
        let board = attempt!(Board::read(&mut db, now).await);

        let (task_id, title, note, question) = match operation {
            WaitsOperation::Get { id } => return get(&board, &id),
            WaitsOperation::Release { id, answer } => {
                let id = found!(board.resolve(&id, "expectation"));
                let wait = found!(released_wait(&board, &id));
                if !attempt!(board.writes_task(&mut db, &wait.parent_id, now).await) {
                    return access::refuse("expectation", &id, AccessLevel::Write);
                }
                let user_source = attempt!(db.undo().set_source(WriteSource::Mcp).await);
                let released = attempt!(
                    crate::nodes::write::update_expectation(
                        &mut db,
                        &id,
                        UpdateExpectationRequest {
                            status: Some(ExpectationStatus::Released),
                            answer: answer.map(Some),
                            ..Default::default()
                        },
                        now,
                    )
                    .await
                );
                attempt!(db.undo().set_source(user_source).await);
                attempt!(db.commit().await);
                (self.announce)(None);
                return result::ok(board.names.stamped(released, NodeTable::Expectation));
            }
            WaitsOperation::Ask {
                task_id,
                title,
                note,
            } => (task_id, title, note, true),
            WaitsOperation::Raise {
                task_id,
                title,
                note,
                question,
            } => (task_id, title, note, question),
        };

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
                question: Some(question),
                ..Default::default()
            },
            now,
        )
        .await;
        let wait = attempt!(created);

        attempt!(db.undo().set_source(user_source).await);
        attempt!(db.commit().await);
        (self.announce)(None);

        result::ok(board.names.stamped(wait, NodeTable::Expectation))
    }
}

/// `get`: one visible wait, as an agent polls it.
fn get(board: &Board, id: &NodeIdParam) -> Answer {
    let id = found!(board.resolve(id, "expectation"));
    let Some(wait) = board.load.expectations.iter().find(|wait| wait.id == id) else {
        return access::refuse("expectation", &id, AccessLevel::Read);
    };
    // The wait's own row, as the snapshot's `expectations` carry it: the same field names.
    result::ok(board.names.stamped(wait, NodeTable::Expectation))
}

/// The visible agentic wait `id` names — the only kind an agent releases.
fn released_wait<'board>(board: &'board Board, id: &NodeId) -> Result<&'board Expectation, Answer> {
    match board.load.expectations.iter().find(|wait| &wait.id == id) {
        Some(wait) if wait.agentic && wait.parent_type == "task" => Ok(wait),
        _ => Err(result::not_permitted(format!(
            "expectation {id} is not an agentic wait inside the MCP roots, so it cannot be \
             released by an agent"
        ))),
    }
}
