//! Task tools — the reads the snapshot does not answer, and the writes an agent may make.
//!
//! The writes follow one access rule (`docs/spec/mcp-server.md`, "Access"): an agent may
//! **create** a Task anywhere inside the MCP roots except under a Task explicitly Not agentic, and
//! what it creates is always Agentic; every other write needs a Task that reads as Agentic. A
//! Habit occurrence is written like any Task — the write lands in its overlay — except that it
//! cannot move.
//!
//! None of it is undoable from the app. Each write is journaled under the `mcp` source, like the
//! issue links, so it never enters the user's Undo Stack and never lands inside a gesture the user
//! has open.

use chrono::NaiveDateTime;
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ErrorData},
    tool, tool_router,
};
use serde_json::Value;

use super::{
    access,
    ids::full_id,
    lookup::{found, Answer, Board},
    params::{BriefParam, NodeIdParam, TaskStatusParam, TasksOperation},
    result,
    result::attempt,
    ArleshMcp,
};
use crate::{
    access::model::{AccessLevel, NodeTable},
    database::session::{Db, Transactional},
    nodes::id::NodeId,
    tasks::model::{
        AgenticBrief, CreateTaskRequest, Task, TaskAgentic, TaskArchival, TaskId, TaskStatus,
        TimeScope, UpdateTaskRequest,
    },
    undo::model::WriteSource,
};

/// One write, checked and ready to run as the agent.
enum Write {
    /// A new Task.
    Create(CreateTaskRequest),
    /// A change to an existing Task, stored or an occurrence.
    Update(NodeId, UpdateTaskRequest),
    /// A Habit occurrence archived.
    ArchiveOccurrence(NodeId),
}

#[tool_router(router = tasks_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Task reads the snapshot does not answer, and the writes an agent may make.
    ///
    /// Reads: `get` returns a task together with its block reasons — both the explicit ones and
    /// those implied by its unmet dependencies, which the snapshot gives you only as raw edges.
    /// `containment_conflicts` asks which descendants would violate the containment invariant if a
    /// node were given a particular window; it is a what-if and changes nothing.
    ///
    /// Writes: `create` makes a Task, always Agentic, anywhere inside the MCP roots that holds one
    /// — except under a Task explicitly marked Not agentic. `update` (title, brief, backlog),
    /// `set_status`, `move` and `archive` need a Task that reads as Agentic. `set_status` is a
    /// compare-and-set: it names the status you last saw, and if the Task has moved on since it
    /// is refused as `status_changed` with the current status, writing nothing. Starting an
    /// Agentic Task needs a Spec in its brief. `move` needs create permission at both the old and
    /// the new parent; a Habit occurrence cannot move. `archive` never deletes: a Habit occurrence
    /// is archived as the app archives one, and a stored Task — which is never archived by hand —
    /// is set aside in the Backlog, its Plan cleared. A write to a Habit occurrence lands in its
    /// overlay, as the user's own edit would.
    ///
    /// Ids are row ids or short ids (the snapshot's `short_id`); a short id matching several
    /// nodes is refused as `ambiguous_id`, listing them. A node outside the MCP roots, or one you
    /// may not write, is refused as `not_permitted`. What `get` returns is cut to the roots.
    #[tool(
        name = "arlesh_tasks",
        annotations(
            title = "Arlesh tasks",
            read_only_hint = false,
            destructive_hint = false
        )
    )]
    pub async fn tasks(
        &self,
        Parameters(operation): Parameters<TasksOperation>,
    ) -> Result<CallToolResult, ErrorData> {
        // Transactional for the reads too: a short id is read against the board, and a write's
        // access check, its compare-and-set and the write itself must see one board.
        let mut db = match self.factory.begin().await {
            Ok(db) => db,
            Err(error) => return result::failed(error),
        };
        let now = self.now();
        let board = attempt!(Board::read(&mut db, now).await);

        let write = match operation {
            TasksOperation::Get { id } => return get(&mut db, &board, &id).await,
            TasksOperation::ContainmentConflicts { node, time_scope } => {
                let id = found!(board.resolve(&node.node_id, &node.node_type));
                let Some(row) = id.stored() else {
                    return result::refused(format!(
                        "{} {id} is a Habit occurrence; its window is its iteration's",
                        node.node_type
                    ));
                };
                if !access::reads(&board.map, &node.node_type, row) {
                    return access::refuse(&node.node_type, row, AccessLevel::Read);
                }
                let window = attempt!(TimeScope::try_from(time_scope));
                let mut conflicts = attempt!(
                    crate::tasks::conflicts_for_new_time_scope(
                        &mut db,
                        &node.node_type,
                        row,
                        &window
                    )
                    .await
                );
                conflicts.retain(|descendant| {
                    access::reads(&board.map, &descendant.node_type, descendant.node_id)
                });
                return result::ok(conflicts);
            }
            TasksOperation::Create {
                parent_type,
                parent_id,
                title,
                brief,
            } => {
                let parent = found!(board.resolve(&parent_id, &parent_type));
                if !board.may_create_under(&parent_type, &parent) {
                    return result::not_permitted(format!(
                        "a Task cannot be created under {parent_type} {parent}: it is not inside \
                         the MCP roots, cannot hold a Task, or is a Task marked Not agentic"
                    ));
                }
                Write::Create(CreateTaskRequest {
                    title,
                    parent_type: parent_type.clone(),
                    parent_id: parent,
                    agentic: Some(TaskAgentic::Yes),
                    agentic_brief: brief.map(|brief| brief.over(AgenticBrief::default())),
                    ..Default::default()
                })
            }
            TasksOperation::Update {
                id,
                title,
                brief,
                backlog,
            } => {
                let (id, task) = found!(writable(&mut db, &board, &id, now).await);
                Write::Update(
                    id,
                    UpdateTaskRequest {
                        title,
                        agentic_brief: brief.map(|brief| Some(merged(brief, task))),
                        archival: backlog.map(|backlog| match backlog {
                            true => TaskArchival::Backlog,
                            false => TaskArchival::Live,
                        }),
                        ..Default::default()
                    },
                )
            }
            TasksOperation::SetStatus {
                id,
                expected,
                status,
            } => {
                let (id, task) = found!(writable(&mut db, &board, &id, now).await);
                // The compare half of the compare-and-set. The session holds SQLite's one writer
                // lock from its first statement, so nothing can change the status between this
                // read and the write below.
                if task.status != spelling(expected) {
                    return result::status_changed(&task.status);
                }
                Write::Update(
                    id,
                    UpdateTaskRequest {
                        status: Some(status.into()),
                        ..Default::default()
                    },
                )
            }
            TasksOperation::Move {
                id,
                parent_type,
                parent_id,
            } => {
                let (id, task) = found!(writable(&mut db, &board, &id, now).await);
                if matches!(id, NodeId::Derived(_)) {
                    return result::refused(format!(
                        "task {id} is a Habit occurrence, which hangs where its Habit puts it \
                         and cannot move"
                    ));
                }
                let parent = found!(board.resolve(&parent_id, &parent_type));
                let leaves = board.may_create_under(&task.parent_type, &task.parent_id);
                if !leaves || !board.may_create_under(&parent_type, &parent) {
                    return result::not_permitted(format!(
                        "task {id} cannot move from {} {} to {parent_type} {parent}: a Task may \
                         only move between parents it could be created under",
                        task.parent_type, task.parent_id
                    ));
                }
                Write::Update(
                    id,
                    UpdateTaskRequest {
                        parent_type: Some(parent_type.clone()),
                        parent_id: Some(parent),
                        ..Default::default()
                    },
                )
            }
            TasksOperation::Archive { id } => {
                let (id, _) = found!(writable(&mut db, &board, &id, now).await);
                match id {
                    NodeId::Derived(_) => Write::ArchiveOccurrence(id),
                    NodeId::Stored(_) => Write::Update(
                        id,
                        UpdateTaskRequest {
                            archival: Some(TaskArchival::Backlog),
                            plan: Some(None),
                            ..Default::default()
                        },
                    ),
                }
            }
        };

        let user_source = attempt!(db.undo().set_source(WriteSource::Mcp).await);
        let written = attempt!(run(&mut db, write, now).await);
        attempt!(db.undo().set_source(user_source).await);
        attempt!(db.commit().await);
        (self.announce)(None);

        result::ok(match written {
            Some(task) => named(&board, task),
            None => serde_json::json!({ "archived": true }),
        })
    }
}

/// `get`: one stored Task with its block reasons, cut to the roots.
async fn get(db: &mut Db<Transactional>, board: &Board, id: &NodeIdParam) -> Answer {
    let id = found!(board.resolve(id, "task"));
    let Some(row) = id.stored() else {
        return result::refused(format!(
            "task {id} is a Habit occurrence; the snapshot carries it and its block reasons"
        ));
    };
    if !access::reads(&board.map, "task", row) {
        return access::refuse("task", row, AccessLevel::Read);
    }
    let mut found = attempt!(crate::tasks::get_task_with_blockers(db, TaskId(row)).await);
    let dependencies = attempt!(db.tasks().list_dependencies(TaskId(row)).await);
    access::restrict_task(&mut found.task, &board.map);
    access::restrict_block_reasons(&mut found.block_reasons, &dependencies, &board.map);
    result::ok(found)
}

/// The Task `id` names, when the MCP may write it — with its row as the board shows it.
async fn writable<'board>(
    db: &mut Db<Transactional>,
    board: &'board Board,
    id: &NodeIdParam,
    now: NaiveDateTime,
) -> Result<(NodeId, &'board Task), Answer> {
    let id = board.resolve(id, "task")?;
    let writes = match board.writes_task(db, &id, now).await {
        Ok(writes) => writes,
        Err(error) => return Err(result::failed(error)),
    };
    match board.task(&id) {
        Some(task) if writes => Ok((id, task)),
        _ => Err(access::refuse("task", &id, AccessLevel::Write)),
    }
}

/// Runs a checked write. `None` for an archived occurrence, which no longer reads as a row.
async fn run(
    db: &mut Db<Transactional>,
    checked: Write,
    now: NaiveDateTime,
) -> Result<Option<Task>, crate::error::AppError> {
    use crate::nodes::write;
    Ok(match checked {
        Write::Create(request) => Some(write::create_task(db, request, now).await?),
        Write::Update(id, request) => Some(write::update_task(db, &id, request, now).await?),
        Write::ArchiveOccurrence(id) => {
            write::delete(db, "task", &id, now).await?;
            None
        }
    })
}

/// A brief's changed fields written over the Task's current brief.
fn merged(brief: BriefParam, task: &Task) -> AgenticBrief {
    brief.over(task.agentic_brief.clone().unwrap_or_default())
}

/// A status as a Task row spells it.
fn spelling(status: TaskStatusParam) -> &'static str {
    TaskStatus::from(status).as_str()
}

/// A written Task as the tool returns it: the row, with the full and short id it goes by.
///
/// The short id is worked out against the board read before the write, with the Task in it — a
/// Task just created was not on that board, and may lengthen a neighbour's short id, which the
/// next read will show.
fn named(board: &Board, task: Task) -> Value {
    let full = full_id(NodeTable::Task, &task.id);
    let short = board.names.short_id_among(&full);
    let mut value = serde_json::to_value(&task).unwrap_or(Value::Null);
    if let Value::Object(fields) = &mut value {
        fields.insert("full_id".into(), Value::String(full));
        fields.insert("short_id".into(), Value::String(short));
    }
    value
}
