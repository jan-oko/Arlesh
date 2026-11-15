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
    lookup::{found, Answer, Board},
    params::{BriefParam, DelegateParam, NodeIdParam, TasksOperation},
    relations::{Asked, Relations},
    result,
    result::attempt,
    short, ArleshMcp,
};
use crate::{
    access::model::{AccessLevel, NodeTable},
    database::session::{Db, Transactional},
    knowledge_base::model::PersonId,
    nodes::{id::NodeId, rules::parenting::stored_reference},
    tasks::model::{
        AgenticBrief, AgenticStatus, CreateTaskRequest, Delegate, Status, Task, TaskAgentic,
        TaskArchival, TaskId, TimeScope, UpdateTaskRequest,
    },
    undo::model::WriteSource,
};

/// One write, checked and ready to run as the agent.
enum Write {
    /// A new Task, its delegate, and its prerequisites, tags and block reasons.
    Create(CreateTaskRequest, Option<Delegate>, Relations),
    /// A change to an existing Task, stored or an occurrence, and to its relations.
    Update(NodeId, UpdateTaskRequest, Relations),
    /// A Habit occurrence archived, through its tombstone.
    ArchiveOccurrence(NodeId),
}

#[tool_router(router = tasks_router, vis = "pub(super)")]
impl ArleshMcp {
    /// Task reads the snapshot does not answer, and the writes an agent may make.
    ///
    /// Reads: `get` returns a task together with its block reasons — both the explicit ones and
    /// those implied by its unmet dependencies, which the snapshot gives you only as raw edges —
    /// and its `infos`: the Info notes directly under it (not under its sub-items), in board
    /// order, each with its ids, `body` and `details`. **The user writes a Task's details as
    /// Infos, so read them before you work a Task.**
    /// `containment_conflicts` asks which descendants would violate the containment invariant if a
    /// node were given a particular window; it is a what-if and changes nothing.
    ///
    /// Writes: `create` makes a Task, always Agentic, anywhere inside the MCP roots that holds one
    /// — except under a Task explicitly marked Not agentic. `update`, `set_status`, `move` and
    /// `archive`/`unarchive` need a Task that reads as Agentic. `create` and `update` also set its Time Scope,
    /// Plan and due (scope ids, as `containment_conflicts` takes them; the Plan and the due within
    /// the Time Scope), `on_scope_exit` (`keep` is Keep Overdue), `asynchronous`, its explicit
    /// `block_reasons`, its tags (Tag ids), its `delegate` (`{"kind": "person",
    /// "id": N}` — an existing Person — or `null` on update to take it back; a delegated Task is
    /// hidden under Plan and Start unless the filter's `delegated` pill says otherwise) and its
    /// prerequisites —
    /// what it comes after, a task, goal or wait: `dependencies` on create,
    /// `add_dependencies`/`remove_dependencies` (and `add_tags`/`remove_tags`) on update. A
    /// prerequisite or tag need only be visible; one that is not is `not_permitted`, and a
    /// dependency cycle is `invalid_request`. An update is one transaction: all of it lands or none
    /// does. `set_status` is a
    /// compare-and-set: it names the status you last saw, and if the Task has moved on since it
    /// is refused as `status_changed` with the current status, writing nothing. An Agentic Task's
    /// status is `todo`, `on_agent` (an agent holds it), `review` (on_agent with your question
    /// open — derived, never set), `doing` (the user is on it) or `done`. You claim one with
    /// `todo` → `on_agent`, which needs a Spec in its brief, hand it back with `todo` and finish
    /// it with `done`; `doing` and `review` are refused. To leave it with the user, raise a
    /// question (`arlesh_waits.ask`): it reads `review` until answered, and `expected` may name
    /// `review`. That holds for a `todo` Task too: a question asked before claiming (the way to
    /// say a Spec is missing) makes it read `review`, and the row stays `todo`. `expected` is
    /// compared with the status the board shows, so name `review` for it, never `todo`; the
    /// claim `review` → `on_agent` is then allowed because the row holds `todo`, and it keeps
    /// reading `review` while the question is open. Answered, it reads `todo` again. A Task that **consists of its sub-items**
    /// (`compound`, set with `update`) has its status derived from its whole subtree, so
    /// `set_status` on it is refused; `update` with `compound: false` switches that off and
    /// keeps the status it showed. `move` needs create permission at both the old and
    /// the new parent; a Habit occurrence cannot move. `archive` never deletes: a stored Task is
    /// archived by hand, and it and everything beneath it read as archived until `unarchive`
    /// makes it Live again; a Habit occurrence is archived as the app archives one, and a status
    /// brings it back. A write to a Habit occurrence lands in its overlay, as the user's own edit
    /// would.
    ///
    /// **A write answers briefly**: `id`, `short_id`, `full_id`, `title` and `status` (an `update`
    /// adds `changed`, the names of the fields it set), not the Task's whole brief. Pass
    /// `verbose: true` for the whole Task as `get` returns it.
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
        let board = attempt!(self.board(&mut db, now).await);

        // What the write answers with: set by the arm that runs it, from its `verbose`.
        let verbose_answer: bool;
        // The fields an `update` sets, named in its short answer.
        let mut changed: Option<Vec<&'static str>> = None;
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
                time_scope,
                on_scope_exit,
                plan,
                due_scope,
                asynchronous,
                dependencies,
                tags,
                block_reasons,
                delegate,
                verbose,
            } => {
                verbose_answer = short::is_verbose(verbose);
                let parent = found!(board.resolve(&parent_id, &parent_type));
                if !board.may_create_under(&parent_type, &parent) {
                    return result::not_permitted(format!(
                        "a Task cannot be created under {parent_type} {parent}: it is not inside \
                         the MCP roots, cannot hold a Task, or is a Task marked Not agentic"
                    ));
                }
                let relations = found!(Relations::read(
                    &board,
                    Asked {
                        add_dependencies: dependencies,
                        add_tags: tags,
                        block_reasons: (!block_reasons.is_empty()).then_some(block_reasons),
                        ..Default::default()
                    }
                ));
                Write::Create(
                    CreateTaskRequest {
                        title,
                        parent_type: stored_reference(&parent_type).to_string(),
                        parent_id: parent,
                        agentic: Some(TaskAgentic::Yes),
                        agentic_brief: brief.map(|brief| brief.over(AgenticBrief::default())),
                        time_scope: attempt!(time_scope.map(TimeScope::try_from).transpose()),
                        on_scope_exit: on_scope_exit.map(Into::into),
                        plan: attempt!(plan.map(TimeScope::try_from).transpose()),
                        due_scope: attempt!(due_scope.map(TimeScope::try_from).transpose()),
                        asynchronous,
                        ..Default::default()
                    },
                    found!(delegate_named(&mut db, delegate).await),
                    relations,
                )
            }
            TasksOperation::Update {
                id,
                title,
                brief,
                backlog,
                time_scope,
                on_scope_exit,
                plan,
                due_scope,
                asynchronous,
                compound,
                add_dependencies,
                remove_dependencies,
                add_tags,
                remove_tags,
                block_reasons,
                delegate,
                verbose,
            } => {
                verbose_answer = short::is_verbose(verbose);
                changed = Some(changed_fields(&[
                    ("title", title.is_some()),
                    ("brief", brief.is_some()),
                    ("backlog", backlog.is_some()),
                    ("time_scope", time_scope.is_some()),
                    ("on_scope_exit", on_scope_exit.is_some()),
                    ("plan", plan.is_some()),
                    ("due_scope", due_scope.is_some()),
                    ("asynchronous", asynchronous.is_some()),
                    ("compound", compound.is_some()),
                    ("add_dependencies", !add_dependencies.is_empty()),
                    ("remove_dependencies", !remove_dependencies.is_empty()),
                    ("add_tags", !add_tags.is_empty()),
                    ("remove_tags", !remove_tags.is_empty()),
                    ("block_reasons", block_reasons.is_some()),
                    ("delegate", delegate.is_some()),
                ]));
                let (id, task) = found!(writable(&mut db, &board, &id, now).await);
                let delegate_to = match delegate {
                    Some(delegate) => Some(found!(delegate_named(&mut db, delegate).await)),
                    None => None,
                };
                if on_scope_exit.is_some() && matches!(id, NodeId::Derived(_)) {
                    return result::refused(format!(
                        "task {id} is a Habit occurrence; what it does when its window passes is \
                         its Habit's, so on_scope_exit cannot be set on it"
                    ));
                }
                let relations = found!(Relations::read(
                    &board,
                    Asked {
                        add_dependencies,
                        remove_dependencies,
                        add_tags,
                        remove_tags,
                        block_reasons: block_reasons.map(Option::unwrap_or_default),
                    }
                ));
                Write::Update(
                    id,
                    UpdateTaskRequest {
                        title,
                        agentic_brief: brief.map(|brief| Some(merged(brief, task))),
                        archival: backlog.map(|backlog| match backlog {
                            true => TaskArchival::Backlog,
                            false => TaskArchival::Live,
                        }),
                        time_scope: attempt!(window_change(time_scope)),
                        on_scope_exit: on_scope_exit.map(|exit| Some(exit.into())),
                        plan: attempt!(window_change(plan)),
                        due_scope: attempt!(window_change(due_scope)),
                        asynchronous,
                        delegate_to,
                        compound,
                        ..Default::default()
                    },
                    relations,
                )
            }
            TasksOperation::SetStatus {
                id,
                expected,
                status,
                verbose,
            } => {
                verbose_answer = short::is_verbose(verbose);
                let (id, task) = found!(writable(&mut db, &board, &id, now).await);
                // The compare half of the compare-and-set, against the status the board shows —
                // Review included. The session holds SQLite's one writer lock from its first
                // statement, so nothing can change the status between this read and the write.
                let expected = Status::Agentic(expected.into());
                if task.status != expected {
                    return result::status_changed(task.status.as_str());
                }
                let status = AgenticStatus::from(status);
                // A Task reading Review may hold To Do (a question asked before claiming) or On
                // Agent; what the row holds decides whether it can be claimed.
                let held = attempt!(stored_status(&mut db, &id, task.status).await);
                if let Some(refusal) = refused_status_write(held, status) {
                    return result::refused(refusal);
                }
                Write::Update(
                    id,
                    UpdateTaskRequest {
                        status: Some(Status::Agentic(status)),
                        ..Default::default()
                    },
                    Relations::default(),
                )
            }
            TasksOperation::Move {
                id,
                parent_type,
                parent_id,
                verbose,
            } => {
                verbose_answer = short::is_verbose(verbose);
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
                        parent_type: Some(stored_reference(&parent_type).to_string()),
                        parent_id: Some(parent),
                        ..Default::default()
                    },
                    Relations::default(),
                )
            }
            TasksOperation::Archive { id, verbose } => {
                verbose_answer = short::is_verbose(verbose);
                let (id, _) = found!(writable(&mut db, &board, &id, now).await);
                match id {
                    NodeId::Stored(_) => Write::Update(
                        id,
                        UpdateTaskRequest {
                            archival: Some(TaskArchival::Archived),
                            ..Default::default()
                        },
                        Relations::default(),
                    ),
                    NodeId::Derived(_) => Write::ArchiveOccurrence(id),
                }
            }
            TasksOperation::Unarchive { id, verbose } => {
                verbose_answer = short::is_verbose(verbose);
                let (id, task) = found!(writable(&mut db, &board, &id, now).await);
                if matches!(id, NodeId::Derived(_)) {
                    return result::refused(format!(
                        "task {id} is a Habit occurrence; an archived one comes back when you \
                         set its status"
                    ));
                }
                if task.archival != TaskArchival::Archived {
                    return result::refused(format!(
                        "task {id} is not archived by hand, so there is nothing to unarchive"
                    ));
                }
                Write::Update(
                    id,
                    UpdateTaskRequest {
                        archival: Some(TaskArchival::Live),
                        ..Default::default()
                    },
                    Relations::default(),
                )
            }
        };

        let user_source = attempt!(db.undo().set_source(WriteSource::Mcp).await);
        let written = attempt!(run(&mut db, write, now).await);
        attempt!(db.undo().set_source(user_source).await);
        attempt!(db.commit().await);
        (self.announce)(None);

        result::ok(match written {
            Some(mut task) => {
                access::restrict_task(&mut task, &board.map);
                let row = board.names.stamped(task, NodeTable::Task);
                match verbose_answer {
                    true => row,
                    false => short::task(&row, changed.as_deref()),
                }
            }
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
    // A compound Task's status is derived from its sub-items, and an Agentic one's Review from its
    // questions: the board serves both, so every Task's status is read from it.
    let served: std::collections::HashMap<i64, Status> = board
        .load
        .tasks
        .iter()
        .filter_map(|task| Some((task.id.stored()?, task.status)))
        .collect();
    // Each dependency it is blocked by is named by its short id, as the MCP shows every node.
    let names = board.names.short_ids_by_key();
    let mut found =
        attempt!(crate::tasks::get_task_with_blockers_as(db, TaskId(row), &served, &names).await);
    // A block the board derived — the agent capacity lock's, or a Compound Task's — is on the
    // board, not in a row.
    found.block_reasons.extend(
        board
            .load
            .block_reasons
            .iter()
            .filter(|reason| reason.derived.is_some())
            .filter(|reason| reason.owner_type == "task" && reason.owner_id == NodeId::Stored(row))
            .map(|reason| reason.reason.clone()),
    );
    let dependencies = attempt!(db.tasks().list_dependencies(TaskId(row)).await);
    access::restrict_task(&mut found.task, &board.map);
    access::restrict_block_reasons(&mut found.block_reasons, &dependencies, &board.map, &names);
    let infos = super::infos::as_read(
        &super::infos::directly_under(&board.load, &id),
        &board.names,
    );
    let mut found = serde_json::to_value(found).unwrap_or(Value::Null);
    if let Value::Object(fields) = &mut found {
        // The user writes a Task's details as Infos under it, so they come back with it.
        fields.insert("infos".into(), infos);
    }
    if let Some(task) = found.get_mut("task") {
        board.names.stamp(task, NodeTable::Task);
        super::snapshot::stamp_effective_plan(task, &board.load.plans, &names);
    }
    result::ok(found)
}

/// What the row of the Task `id` holds, given the `shown` status the board reads for it: the same
/// unless it reads Review, which is derived and which a To Do or an On Agent row can read. An
/// occurrence has no row of its own and reads as shown.
pub(super) async fn stored_status(
    db: &mut Db<Transactional>,
    id: &NodeId,
    shown: Status,
) -> Result<Status, crate::tasks::error::TaskError> {
    match (id.stored(), shown) {
        (Some(row), Status::Agentic(AgenticStatus::Review)) => {
            Ok(db.tasks().get(TaskId(row)).await?.status)
        }
        _ => Ok(shown),
    }
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

/// Runs a checked write: the row, then its relations, all inside the caller's transaction, so a
/// refusal part-way writes nothing. `None` for an archived occurrence, which no longer reads as a
/// row.
async fn run(
    db: &mut Db<Transactional>,
    checked: Write,
    now: NaiveDateTime,
) -> Result<Option<Task>, crate::error::AppError> {
    use crate::nodes::write;
    let (task, relations) = match checked {
        Write::Create(request, delegate, relations) => {
            let task = write::create_task(db, request, now).await?;
            let task = match delegate {
                // The create request has no delegate; the same transaction sets it on the new row.
                Some(delegate) => {
                    let request = UpdateTaskRequest {
                        delegate_to: Some(Some(delegate)),
                        ..Default::default()
                    };
                    write::update_task(db, &task.id, request, now).await?
                }
                None => task,
            };
            (task, relations)
        }
        Write::Update(id, request, relations) => {
            (write::update_task(db, &id, request, now).await?, relations)
        }
        Write::ArchiveOccurrence(id) => {
            write::delete(db, "task", &id, now).await?;
            return Ok(None);
        }
    };
    // A compound Task's row carries its stored status; the board serves the derived one.
    if relations.is_empty() && !task.compound {
        return Ok(Some(task));
    }
    relations.write(db, &task.id, now).await?;
    // Read back, for the tags just written: the row the write returned predates them — and for
    // a compound Task's derived status.
    let reread = crate::mindmap::load(db, now)
        .await?
        .tasks
        .into_iter()
        .find(|row| row.id == task.id);
    Ok(Some(reread.unwrap_or(task)))
}

/// The delegate a write names, once a Person it names is known to exist — refused as `not_found`
/// otherwise, before anything is written.
async fn delegate_named(
    db: &mut Db<Transactional>,
    delegate: Option<DelegateParam>,
) -> Result<Option<Delegate>, Answer> {
    if let Some(DelegateParam::Person { id }) = delegate {
        if let Err(error) = db.people().get(PersonId(id)).await {
            return Err(result::failed(error));
        }
    }
    Ok(delegate.map(Delegate::from))
}

/// The names of the fields whose `(name, was set)` pair says they were.
fn changed_fields(fields: &[(&'static str, bool)]) -> Vec<&'static str> {
    fields
        .iter()
        .filter(|(_, set)| *set)
        .map(|(name, _)| *name)
        .collect()
}

/// A window parameter as the update request takes it: left out, cleared, or a scope to convert.
fn window_change(
    given: Option<Option<super::params::TimeScope>>,
) -> Result<Option<Option<TimeScope>>, crate::scopes::error::ScopeError> {
    given
        .map(|scope| scope.map(TimeScope::try_from).transpose())
        .transpose()
}

/// A brief's changed fields written over the Task's current brief.
fn merged(brief: BriefParam, task: &Task) -> AgenticBrief {
    brief.over(task.agentic_brief.clone().unwrap_or_default())
}

/// Why an agent may not move an Agentic Task from `current` to `status`, if it may not.
///
/// An agent claims a Task (`on_agent`, from `todo`), hands it back (`todo`) or finishes it
/// (`done`). `doing` says the user is working, which only the user says; `review` is derived from a
/// question the agent raises, never set.
fn refused_status_write(current: Status, status: AgenticStatus) -> Option<String> {
    match status {
        AgenticStatus::Doing => Some(
            "`doing` says the user is working on it, which only the user sets; an agent holds a \
             task as `on_agent`"
                .to_string(),
        ),
        AgenticStatus::Review => Some(
            "`review` is not set: raise a question under the task with `arlesh_waits.ask`, and \
             it reads `review` until the question is answered"
                .to_string(),
        ),
        AgenticStatus::OnAgent if current != Status::Agentic(AgenticStatus::Todo) => Some(format!(
            "an agent claims a task from `todo`; this one is `{}`",
            current.as_str()
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
