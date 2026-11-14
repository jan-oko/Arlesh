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
    events::{self, rules::WaitState},
    ids::IdRefusal,
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
        CreateExpectationRequest, Expectation, ExpectationStatus, ReviewDetails,
        UpdateExpectationRequest,
    },
    tasks::review as review_rules,
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
    /// `raise_review` hands finished work back for a verdict: a `title`, a `summary` of what
    /// changed, optional `links` (each a `label` and a `url`: a PR, a doc, a build) and optional
    /// `hand_tests` (a list of what the user can try by hand). It is a question of its own kind:
    /// the Task reads Review until the user answers. A PR link makes their approval their word to
    /// merge it; Arlesh never talks to GitHub. The links show in the app as clickable links, only
    /// for http and https URLs. The Task must be held by you (On Agent, or already Review): claim
    /// it first, or the call is refused. Limits: title 200 characters, summary 10000, at most 20
    /// links (label 100 characters, URL 2000, every link needs both) and 30 hand tests (1000
    /// each). A blank title or summary, a link with a blank half or a URL that is not http or
    /// https is refused as `invalid_request` and says what to change; blank hand tests are
    /// dropped. The answer carries the wait's `id` and `short_id` and the Task's `task_id` and
    /// `task_short_id`. Wait ids and Task ids share one number space, so name nodes by short id,
    /// which cannot be mistaken for the other kind. A Task stays Review while any question or
    /// review under it is open.
    ///
    /// `release` releases an agentic wait under a Task you can write. A question wait needs an
    /// `answer` — ask the user yourself if you can, and record what they said — and is refused
    /// without one; a review needs the user's `verdict` (`approved` or `changes_requested`),
    /// with their note as `answer` — only what the user told you in your session, never your own
    /// verdict; a non-question wait needs none. The user can release any of them from the app, a
    /// question only with an answer and a review only with a verdict.
    ///
    /// A wait already released is refused when released again (a question or a review): the
    /// user's answer is never overwritten.
    ///
    /// `get` returns one wait as the snapshot's `expectations` carry it — `status`, `question`,
    /// `agentic_note`, `answer`, and for a review the `review` object (`links`, `hand_tests` and,
    /// once the user has answered, `verdict`) — so you can poll for the user's answer without the
    /// snapshot. A wait is a review when `review` is present, a question when `question` is true
    /// without it, and a wait on something else when `question` is false. After `verdict:
    /// approved` merge the PR and set the Task Done; after `changes_requested` fix what the note
    /// says and raise a new review.
    ///
    /// `watch` takes `ids` of waits you want to hear about. It only validates them (each must be an
    /// agentic wait you can see) and answers their current states: it changes nothing on the
    /// board. If your session says Arlesh notifications are on, rely on them: waits you `ask`,
    /// `raise` or `watch` notify you when they are released, reopened, archived or deleted, so do
    /// not poll `get` and do not sleep. If it does not say so, do not wait on a wait: nothing will
    /// wake you, so ask the question where your conversation can carry the answer, too.
    ///
    /// `get_many` reads several waits at once (`ids` as full ids, short ids or row ids): each one's
    /// state, or `gone: true` when it is deleted or out of your sight.
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

        let (task_id, title, note, question, review) = match operation {
            WaitsOperation::Get { id } => return get(&board, &id),
            WaitsOperation::Watch { ids } => return watch(&board, &ids),
            WaitsOperation::GetMany { ids } => return get_many(&board, &ids),
            WaitsOperation::Release {
                id,
                answer,
                verdict,
            } => {
                let id = found!(board.resolve(&id, "expectation"));
                let wait = found!(released_wait(&board, &id));
                if let Err(refusal) = review_rules::require_open_for_agent_release(wait) {
                    return result::refused(refusal.to_string());
                }
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
                            verdict,
                            ..Default::default()
                        },
                        now,
                    )
                    .await
                );
                attempt!(db.undo().set_source(user_source).await);
                attempt!(db.commit().await);
                (self.announce)(None);
                return result::ok(stamped_wait(&board, &released));
            }
            WaitsOperation::Ask {
                task_id,
                title,
                note,
            } => (task_id, title, note, true, None),
            WaitsOperation::RaiseReview {
                task_id,
                title,
                summary,
                links,
                hand_tests,
            } => (
                task_id,
                title,
                Some(summary),
                true,
                Some(ReviewDetails { links, hand_tests }),
            ),
            WaitsOperation::Raise {
                task_id,
                title,
                note,
                question,
            } => (task_id, title, note, question, None),
        };

        let task_id = found!(board.resolve(&task_id, "task"));
        if !attempt!(board.writes_task(&mut db, &task_id, now).await) {
            return access::refuse("task", &task_id, AccessLevel::Write);
        }
        if review.is_some() {
            // A review hands work back, so the Task must be held by an agent: the board's own
            // derived status says whether it is (On Agent, or already Review).
            let held = board
                .load
                .tasks
                .iter()
                .find(|task| task.id == task_id)
                .map(|task| review_rules::require_held(&task.status));
            if let Some(Err(refusal)) = held {
                return result::refused(refusal.to_string());
            }
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
                review,
                ..Default::default()
            },
            now,
        )
        .await;
        let wait = attempt!(created);

        attempt!(db.undo().set_source(user_source).await);
        attempt!(db.commit().await);
        (self.announce)(None);

        result::ok(stamped_wait(&board, &wait))
    }
}

/// `wait` as the snapshot's `expectations` carry it, with the Task it hangs under named the way
/// `get_many` names it: `task_id` and `task_short_id`.
fn stamped_wait(board: &Board, wait: &Expectation) -> serde_json::Value {
    let mut value = board.names.stamped(wait, NodeTable::Expectation);
    let state = events::wait_state(board, wait);
    if let Some(object) = value.as_object_mut() {
        object.insert("task_id".into(), state.task_id.into());
        object.insert("task_short_id".into(), state.task_short_id.into());
    }
    value
}

/// `get`: one visible wait, as an agent polls it.
fn get(board: &Board, id: &NodeIdParam) -> Answer {
    let id = found!(board.resolve(id, "expectation"));
    let Some(wait) = board.load.expectations.iter().find(|wait| wait.id == id) else {
        return access::refuse("expectation", &id, AccessLevel::Read);
    };
    // The wait's own row, as the snapshot's `expectations` carry it: the same field names.
    result::ok(stamped_wait(board, wait))
}

/// One id of `watch` or `get_many`, answered: the wait's state, or that it is gone.
#[derive(serde::Serialize)]
struct Watched {
    /// The id as it was asked for.
    id: String,
    /// Whether no visible wait has this id any more.
    gone: bool,
    #[serde(flatten)]
    state: Option<WaitState>,
}

/// Reads each of `ids` against the board. A wait that no visible node answers to is `gone`, unless
/// `refuse_gone` — then it is refused, as an id the agent has misread.
fn watched(board: &Board, ids: &[NodeIdParam], refuse_gone: bool) -> Result<Vec<Watched>, Answer> {
    let mut answers = Vec::with_capacity(ids.len());
    for id in ids {
        let text = id.text();
        let named = match board.names.resolve_as(&text, Some(NodeTable::Expectation)) {
            Ok(named) => Some(named),
            Err(IdRefusal::Unknown) if !refuse_gone => None,
            Err(IdRefusal::Unknown) => {
                return Err(result::not_permitted(format!(
                    "no wait inside the MCP roots has the id {text}"
                )))
            }
            Err(IdRefusal::Ambiguous(candidates)) => {
                return Err(result::ambiguous(&text, &candidates))
            }
            Err(IdRefusal::WrongKind(node)) => {
                return Err(result::refused(format!(
                    "{text} is a {} ({}), not a wait",
                    node.kind, node.title
                )))
            }
        };
        let wait = named.and_then(|named| {
            board
                .load
                .expectations
                .iter()
                .find(|wait| wait.id == named.node_id)
        });
        if refuse_gone && wait.is_some_and(|wait| !wait.agentic) {
            return Err(result::refused(format!(
                "{text} is not an agentic wait: only the waits an agent raises can be watched"
            )));
        }
        answers.push(Watched {
            id: text,
            gone: wait.is_none(),
            state: wait.map(|wait| events::wait_state(board, wait)),
        });
    }
    Ok(answers)
}

/// `watch`: validates the ids and answers the waits' current states.
fn watch(board: &Board, ids: &[NodeIdParam]) -> Answer {
    let waits = found!(watched(board, ids, true));
    result::ok(serde_json::json!({ "waits": waits }))
}

/// `get_many`: the waits' current states, with `gone` for the ones that no longer exist.
fn get_many(board: &Board, ids: &[NodeIdParam]) -> Answer {
    let waits = found!(watched(board, ids, false));
    result::ok(serde_json::json!({ "waits": waits }))
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
