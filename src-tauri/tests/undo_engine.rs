//! Integration tests for the undo/redo engine.
//!
//! The seam under test is the **board**: every test drives real commands, then undoes, then reads
//! the database back and compares it to what it held before. Asserting only that undo returned
//! `Ok` would pass for an undo that restored an emptied shell, which is precisely the failure this
//! design exists to prevent — so the comparison here is row contents across *every* journaled
//! table, not a count and not a spot check.
//!
//! The pool has **one** connection (see [`helpers::test_pool`]), so every read happens after the
//! session that wrote it has closed.

mod helpers;

use arlesh_lib::commands::beads::clear_beads_id;
use arlesh_lib::commands::block_reasons as block_reason_commands;
use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::commands::tasks as task_commands;
use arlesh_lib::commands::undo as undo_commands;
use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus};
use arlesh_lib::flows::model::{
    CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowItemType, HabitInstanceRef,
    InstanceType,
};
use arlesh_lib::mcp::{params, ArleshMcp};
use arlesh_lib::scopes::model::ScopeKind;
use arlesh_lib::tasks::model::{
    CreateGoalRequest, CreateTaskRequest, Dependency, TaskAgentic, UpdateTaskRequest,
};
use arlesh_lib::undo::model::GestureSummary;
use arlesh_lib::undo::EXCLUDED_TABLES;
use rmcp::handler::server::wrapper::Parameters;
use sqlx::SqlitePool;
use tauri::test::MockRuntime;
use tauri::{App, Manager};

// ---------------------------------------------------------------------------------------------
// Reading the board back.
// ---------------------------------------------------------------------------------------------

/// Every journaled table, read from `sqlite_master` rather than listed.
async fn journaled_tables(pool: &SqlitePool) -> Vec<String> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master \
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations' \
          ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .expect("failed to enumerate tables");
    tables
        .into_iter()
        .filter(|table| !EXCLUDED_TABLES.contains(&table.as_str()))
        .collect()
}

/// One table's rows, each as `rowid` plus a JSON object of every column, in rowid order.
///
/// The rowid is part of what is compared on purpose: a deleted goal that comes back at a different
/// identity comes back as an orphan, and a restore that only matched on contents would call that a
/// success.
async fn dump(pool: &SqlitePool, table: &str) -> Vec<String> {
    let image: String = sqlx::query_scalar(&format!(
        "SELECT 'json_object(' || group_concat(char(39) || name || char(39) || ', ' || name, ', ') \
              || ')' FROM pragma_table_info('{table}')"
    ))
    .fetch_one(pool)
    .await
    .expect("failed to build the column list");

    sqlx::query_scalar(&format!(
        "SELECT rowid || ' ' || {image} FROM \"{table}\" ORDER BY rowid"
    ))
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("failed to dump \"{table}\": {error}"))
}

/// The whole board: every journaled table, every row, every column, by rowid.
async fn board(pool: &SqlitePool) -> Vec<(String, Vec<String>)> {
    let mut snapshot = Vec::new();
    for table in journaled_tables(pool).await {
        let rows = dump(pool, &table).await;
        snapshot.push((table, rows));
    }
    snapshot
}

/// Every journal entry's sequence number, so a test can assert none were added.
async fn journal_sequence(pool: &SqlitePool) -> Vec<i64> {
    sqlx::query_scalar("SELECT seq FROM undo_journal ORDER BY seq")
        .fetch_all(pool)
        .await
        .expect("failed to read the journal")
}

// ---------------------------------------------------------------------------------------------
// Driving the commands.
// ---------------------------------------------------------------------------------------------

async fn open_gesture(app: &App<MockRuntime>) {
    undo_commands::open_gesture(app.state())
        .await
        .expect("open gesture");
}

async fn close_gesture(app: &App<MockRuntime>) -> Option<GestureSummary> {
    undo_commands::close_gesture(helpers::window(app), app.state(), app.state())
        .await
        .expect("close gesture")
}

async fn abort_gesture(app: &App<MockRuntime>) -> Option<GestureSummary> {
    undo_commands::abort_gesture(helpers::window(app), app.state(), app.state())
        .await
        .expect("abort gesture")
}

async fn undo(app: &App<MockRuntime>) -> Option<GestureSummary> {
    undo_commands::undo(helpers::window(app), app.state(), app.state())
        .await
        .expect("undo")
}

async fn redo(app: &App<MockRuntime>) -> Option<GestureSummary> {
    undo_commands::redo(helpers::window(app), app.state(), app.state())
        .await
        .expect("redo")
}

async fn make_project(pool: &SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .expect("the Growth aspect is seeded by the initial migration");
    helpers::session_factory(pool)
        .connect()
        .await
        .expect("connect")
        .domains()
        .create(CreateDomainRequest {
            title: "Undo Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .expect("create project")
        .id
}

async fn make_tag(pool: &SqlitePool, title: &str) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .expect("the Growth aspect is seeded by the initial migration");
    helpers::session_factory(pool)
        .connect()
        .await
        .expect("connect")
        .domains()
        .create(CreateDomainRequest {
            title: title.into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .expect("create tag")
        .id
}

fn task_request(parent_type: &str, parent_id: i64, title: &str) -> CreateTaskRequest {
    CreateTaskRequest {
        title: title.into(),
        parent_type: parent_type.into(),
        parent_id,
        status: None,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        archival: None,
        agentic: None,
        asynchronous: None,
        async_template: None,
    }
}

fn goal_request(parent_type: &str, parent_id: i64, title: &str) -> CreateGoalRequest {
    CreateGoalRequest {
        title: title.into(),
        parent_type: parent_type.into(),
        parent_id,
        status: None,
        time_scope: None,
        on_scope_exit: None,
    }
}

// ---------------------------------------------------------------------------------------------
// One gesture, reversed and reapplied.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn undoing_a_created_task_removes_it_and_redoing_puts_it_back_at_the_same_id() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let before = board(&pool).await;

    open_gesture(&app).await;
    let task = task_commands::create_task(app.state(), task_request("project", project_id, "new"))
        .await
        .expect("create task");
    close_gesture(&app).await;
    let after_gesture = board(&pool).await;

    let undone = undo(&app).await.expect("there is something to undo");
    assert_eq!(
        undone.tables,
        ["tasks"],
        "a create writes the row and then its sort position, both on `tasks`"
    );
    assert!(
        undone.inserted >= 1,
        "one of them is the row itself: {undone:?}"
    );
    assert_eq!(board(&pool).await, before, "undo must restore the board");

    let redone = redo(&app).await.expect("there is something to redo");
    assert_eq!(
        redone.gesture, undone.gesture,
        "redo reapplies what undo took"
    );
    assert_eq!(
        board(&pool).await,
        after_gesture,
        "redo must put back exactly what undo took away, at the same ids"
    );
    assert!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks WHERE id = ?")
            .bind(task.id)
            .fetch_one(&pool)
            .await
            .expect("count")
            == 1,
        "the task must come back at its original id, not a new one"
    );
}

#[tokio::test]
async fn undoing_a_deleted_goal_brings_its_subtree_back_whole() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool, "undo-tag").await;

    // A goal with everything hanging off it that a row-level undo could plausibly drop: a child
    // goal, a task, tags on both, block reasons (whose owner is polymorphic and so has no foreign
    // key to cascade), and a dependency on a task *outside* the subtree.
    let outside =
        task_commands::create_task(app.state(), task_request("project", project_id, "out"))
            .await
            .expect("create outside task");
    let goal = task_commands::create_goal(app.state(), goal_request("project", project_id, "goal"))
        .await
        .expect("create goal");
    let child = task_commands::create_goal(app.state(), goal_request("goal", goal.id, "child"))
        .await
        .expect("create child goal");
    let task = task_commands::create_task(app.state(), task_request("goal", goal.id, "task"))
        .await
        .expect("create task");
    task_commands::add_tag_to_goal(app.state(), goal.id, tag_id)
        .await
        .expect("tag the goal");
    task_commands::add_tag_to_goal(app.state(), child.id, tag_id)
        .await
        .expect("tag the child");
    task_commands::add_tag_to_task(app.state(), task.id, tag_id)
        .await
        .expect("tag the task");
    task_commands::add_task_dependency(app.state(), task.id, Dependency::Task { id: outside.id })
        .await
        .expect("add dependency");
    block_reason_commands::set_block_reasons(
        app.state(),
        "goal".into(),
        goal.id,
        vec!["waiting".into(), "unfunded".into()],
    )
    .await
    .expect("block the goal");
    block_reason_commands::set_block_reasons(
        app.state(),
        "task".into(),
        task.id,
        vec!["stuck".into()],
    )
    .await
    .expect("block the task");

    let before = board(&pool).await;

    open_gesture(&app).await;
    task_commands::delete_goal(app.state(), goal.id)
        .await
        .expect("delete the goal");
    close_gesture(&app).await;

    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM goals WHERE id IN (?, ?)")
            .bind(goal.id)
            .bind(child.id)
            .fetch_one(&pool)
            .await
            .expect("count"),
        0,
        "the delete must actually have happened"
    );

    undo(&app).await.expect("there is something to undo");

    assert_eq!(
        board(&pool).await,
        before,
        "every row of every journaled table must come back, by rowid — children, tags, \
         dependencies and block reasons included"
    );
}

#[tokio::test]
async fn a_gesture_spanning_several_commands_is_reversed_by_one_undo() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let before = board(&pool).await;

    // What a paste looks like from here: one gesture around five commands, each of which opens and
    // closes a gesture of its own and joins the outer one.
    open_gesture(&app).await;
    for index in 0..5 {
        open_gesture(&app).await;
        task_commands::create_task(
            app.state(),
            task_request("project", project_id, &format!("pasted {index}")),
        )
        .await
        .expect("create task");
        assert_eq!(
            close_gesture(&app).await,
            None,
            "a nested close ends nothing and must not make the command undoable on its own"
        );
    }
    let summary = close_gesture(&app).await.expect("the outer close ends it");
    assert!(
        summary.rows >= 5,
        "all five creates belong to one gesture, got {summary:?}"
    );

    assert_eq!(
        undo(&app).await.map(|undone| undone.gesture),
        Some(summary.gesture)
    );
    assert_eq!(
        board(&pool).await,
        before,
        "one press must take all five back"
    );
    assert_eq!(undo(&app).await, None, "and there must be nothing left");
}

#[tokio::test]
async fn an_aborted_gesture_leaves_the_board_exactly_as_it_was() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let task = task_commands::create_task(app.state(), task_request("project", project_id, "kept"))
        .await
        .expect("create task");
    let before = board(&pool).await;
    let journal_before = journal_sequence(&pool).await;

    // What an editor's Save looks like from here: several commands that are one thing the user
    // filled in, the last of which is refused.
    open_gesture(&app).await;
    task_commands::update_task(
        app.state(),
        task.id,
        UpdateTaskRequest {
            title: Some("edited".into()),
            ..Default::default()
        },
    )
    .await
    .expect("update task");
    block_reason_commands::set_block_reasons(
        app.state(),
        "task".into(),
        task.id,
        vec!["waiting on someone".into()],
    )
    .await
    .expect("set block reasons");
    assert_ne!(
        board(&pool).await,
        before,
        "the writes must have landed, or the abort has nothing to take back"
    );

    let aborted = abort_gesture(&app).await.expect("something was taken back");
    assert!(aborted.rows >= 2, "both writes were in it, got {aborted:?}");
    assert_eq!(
        board(&pool).await,
        before,
        "no part of an aborted save may stand"
    );
    assert_eq!(
        journal_sequence(&pool).await,
        journal_before,
        "the entries are dropped with the writes: the reversal is suppressed, so leaving them \
         would leave the journal describing a board that never existed"
    );
}

#[tokio::test]
async fn an_aborted_gesture_is_neither_an_undo_step_nor_clears_the_redo_stack() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    open_gesture(&app).await;
    task_commands::create_task(app.state(), task_request("project", project_id, "first"))
        .await
        .expect("create task");
    let recorded = close_gesture(&app).await.expect("the gesture is undoable");
    undo(&app).await.expect("undone");

    open_gesture(&app).await;
    task_commands::create_task(app.state(), task_request("project", project_id, "refused"))
        .await
        .expect("create task");
    abort_gesture(&app).await.expect("something was taken back");

    let status = undo_commands::undo_status(app.state())
        .await
        .expect("status");
    assert_eq!(
        status.undo, None,
        "a save that was taken back is not a press the user should spend"
    );
    assert_eq!(
        status.redo.map(|summary| summary.gesture),
        Some(recorded.gesture),
        "and it must not have thrown away a redo the user still had"
    );
}

#[tokio::test]
async fn aborting_a_gesture_that_wrote_nothing_does_nothing() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let before = board(&pool).await;

    open_gesture(&app).await;
    task_commands::list_tasks(app.state())
        .await
        .expect("a read changes nothing");

    assert_eq!(abort_gesture(&app).await, None);
    assert_eq!(board(&pool).await, before);
    assert_eq!(
        undo_commands::undo_status(app.state())
            .await
            .expect("status")
            .undo,
        None
    );
}

#[tokio::test]
async fn a_nested_abort_closes_its_own_open_and_leaves_the_gesture_running() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let before = board(&pool).await;

    // The documented shape rather than a behaviour of its own: the outermost open owns the
    // boundary, so a nested caller cannot take back writes the gesture above it may still want.
    open_gesture(&app).await;
    open_gesture(&app).await;
    task_commands::create_task(app.state(), task_request("project", project_id, "inner"))
        .await
        .expect("create task");
    assert_eq!(
        abort_gesture(&app).await,
        None,
        "a nested abort ends nothing"
    );

    let summary = close_gesture(&app).await.expect("the outer close ends it");
    assert!(
        summary.rows >= 1,
        "the inner write is still the outer gesture's, got {summary:?}"
    );
    undo(&app).await.expect("undone");
    assert_eq!(board(&pool).await, before);
}

#[tokio::test]
async fn undo_then_redo_returns_the_board_to_what_the_gesture_made_of_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let task =
        task_commands::create_task(app.state(), task_request("project", project_id, "before"))
            .await
            .expect("create task");
    let before = board(&pool).await;

    open_gesture(&app).await;
    task_commands::update_task(
        app.state(),
        task.id,
        UpdateTaskRequest {
            title: Some("after".into()),
            ..Default::default()
        },
    )
    .await
    .expect("update task");
    close_gesture(&app).await;
    let after_gesture = board(&pool).await;
    assert_ne!(
        before, after_gesture,
        "the update must have changed something"
    );

    undo(&app).await.expect("undo");
    assert_eq!(board(&pool).await, before);

    redo(&app).await.expect("redo");
    assert_eq!(board(&pool).await, after_gesture);
}

// ---------------------------------------------------------------------------------------------
// What the stacks refuse to do.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn undo_and_redo_on_an_empty_stack_do_nothing_and_do_not_fail() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    make_project(&pool).await;
    let before = board(&pool).await;

    assert_eq!(undo(&app).await, None);
    assert_eq!(redo(&app).await, None);
    assert_eq!(
        board(&pool).await,
        before,
        "a press with nothing to act on is not a mistake"
    );
}

#[tokio::test]
async fn a_new_gesture_clears_the_redo_stack() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    open_gesture(&app).await;
    task_commands::create_task(app.state(), task_request("project", project_id, "first"))
        .await
        .expect("create task");
    close_gesture(&app).await;
    undo(&app).await.expect("undo");
    assert!(
        undo_commands::undo_status(app.state())
            .await
            .expect("status")
            .redo
            .is_some(),
        "the undone gesture is on the redo stack"
    );

    open_gesture(&app).await;
    task_commands::create_task(app.state(), task_request("project", project_id, "second"))
        .await
        .expect("create task");
    close_gesture(&app).await;

    let status = undo_commands::undo_status(app.state())
        .await
        .expect("status");
    assert_eq!(
        status.redo, None,
        "redo must never reapply onto a board that has moved on"
    );
    assert_eq!(redo(&app).await, None);
}

#[tokio::test]
async fn a_gesture_that_changed_nothing_never_reaches_the_stack() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    open_gesture(&app).await;
    task_commands::list_tasks(app.state())
        .await
        .expect("a read changes nothing");
    assert_eq!(close_gesture(&app).await, None);

    let status = undo_commands::undo_status(app.state())
        .await
        .expect("status");
    assert_eq!(
        status.undo, None,
        "a press must not be spent on a gesture with no effect"
    );
    let _ = project_id;
}

#[tokio::test]
async fn undo_status_names_what_each_press_would_do() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    open_gesture(&app).await;
    task_commands::create_task(app.state(), task_request("project", project_id, "labelled"))
        .await
        .expect("create task");
    let closed = close_gesture(&app).await.expect("the gesture is undoable");

    let status = undo_commands::undo_status(app.state())
        .await
        .expect("status");
    let offered = status.undo.expect("something to undo");
    assert_eq!(offered.gesture, closed.gesture);
    assert!(
        offered.tables.contains(&"tasks".to_string()),
        "the caller needs the tables to label the press, got {offered:?}"
    );
    assert_eq!(status.redo, None);
}

// ---------------------------------------------------------------------------------------------
// The journal is a history of everything; the stack is a history of the user.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn an_mcp_write_between_the_users_change_and_their_undo_is_not_reversed() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));
    let project_id = make_project(&pool).await;
    let agents_task =
        task_commands::create_task(app.state(), task_request("project", project_id, "agent's"))
            .await
            .expect("create task");

    open_gesture(&app).await;
    task_commands::create_task(app.state(), task_request("project", project_id, "user's"))
        .await
        .expect("create task");
    close_gesture(&app).await;

    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: agents_task.id,
            beads_id: Some("Arlesh-h2u".into()),
        }))
        .await
        .expect("the beads tool returned no result");
    assert_ne!(
        result.is_error,
        Some(true),
        "{:?}",
        result.structured_content
    );

    undo(&app).await.expect("undo");

    assert_eq!(
        sqlx::query_scalar::<_, Option<String>>("SELECT beads_id FROM tasks WHERE id = ?")
            .bind(agents_task.id)
            .fetch_one(&pool)
            .await
            .expect("read beads id"),
        Some("Arlesh-h2u".into()),
        "Ctrl+Z reverses what the user did and never what an agent did"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks WHERE title = 'user''s'")
            .fetch_one(&pool)
            .await
            .expect("count"),
        0,
        "and it must still have reversed the user's own change"
    );
}

#[tokio::test]
async fn an_mcp_write_made_while_a_user_gesture_is_open_is_not_reversed_with_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));
    let project_id = make_project(&pool).await;
    let agents_task =
        task_commands::create_task(app.state(), task_request("project", project_id, "agent's"))
            .await
            .expect("create task");

    // The ambient context is one row for the whole application, so an agent writing while the
    // user's gesture is open is journaled *under that gesture's id*. Only the entry's source tells
    // the two apart, and that is why the journal records one.
    open_gesture(&app).await;
    task_commands::create_task(app.state(), task_request("project", project_id, "user's"))
        .await
        .expect("create task");
    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: agents_task.id,
            beads_id: Some("Arlesh-h2u".into()),
        }))
        .await
        .expect("the beads tool returned no result");
    assert_ne!(
        result.is_error,
        Some(true),
        "{:?}",
        result.structured_content
    );
    let summary = close_gesture(&app).await.expect("the gesture is undoable");

    // The filter has to be doing real work for the rest of this test to mean anything: the agent's
    // entry must be in the journal under this very gesture, and out of what reached the stack.
    let under_gesture = |source: &'static str| {
        let gesture = summary.gesture.0.clone();
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM undo_journal WHERE gesture_id = ? AND source = ?",
            )
            .bind(gesture)
            .bind(source)
            .fetch_one(&pool)
            .await
            .expect("count entries")
        }
    };
    assert_eq!(
        under_gesture("mcp").await,
        1,
        "the agent's write carries the open gesture's id, because the context is one row"
    );
    assert_eq!(
        under_gesture("user").await,
        i64::try_from(summary.rows).expect("small"),
        "and only the user's entries reached the stack, got {summary:?}"
    );

    undo(&app).await.expect("undo");

    assert_eq!(
        sqlx::query_scalar::<_, Option<String>>("SELECT beads_id FROM tasks WHERE id = ?")
            .bind(agents_task.id)
            .fetch_one(&pool)
            .await
            .expect("read beads id"),
        Some("Arlesh-h2u".into()),
        "an entry tagged mcp is never on the user's stack, whatever gesture it landed inside"
    );
}

#[tokio::test]
async fn neither_undo_nor_redo_writes_a_journal_entry() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    open_gesture(&app).await;
    task_commands::create_task(app.state(), task_request("project", project_id, "recorded"))
        .await
        .expect("create task");
    close_gesture(&app).await;
    let after_gesture = journal_sequence(&pool).await;

    undo(&app).await.expect("undo");
    assert_eq!(
        journal_sequence(&pool).await,
        after_gesture,
        "reversing a change must not become a change to reverse"
    );

    redo(&app).await.expect("redo");
    assert_eq!(journal_sequence(&pool).await, after_gesture);

    // And the flag is back where it was, or every write for the rest of the session is dropped.
    let context = helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .undo()
        .context()
        .await
        .expect("read context");
    assert!(
        !context.suppressed,
        "suppression must not outlive the replay"
    );

    open_gesture(&app).await;
    task_commands::create_task(
        app.state(),
        task_request("project", project_id, "still recorded"),
    )
    .await
    .expect("create task");
    assert!(
        close_gesture(&app).await.is_some(),
        "the journal must still be recording after a replay"
    );
}

// ---------------------------------------------------------------------------------------------
// Every column comes back, including the ones added after the triggers were first written.
// ---------------------------------------------------------------------------------------------
//
// `tests/undo_journal.rs` guards the triggers against the schema column by column; these two
// tests are the behaviour that guard stands in for. A column missing from a row image is not an
// error anywhere — the undo succeeds and the column silently keeps its post-change value — so the
// only way to see it is to change such a column and read it back after the undo.

/// The `agentic` flag as the database holds it: `Some(true)`, `Some(false)`, or `None` for a Task
/// that inherits from its ancestors.
async fn agentic(pool: &SqlitePool, task_id: i64) -> Option<bool> {
    sqlx::query_scalar("SELECT agentic FROM tasks WHERE id = ?")
        .bind(task_id)
        .fetch_one(pool)
        .await
        .expect("read agentic")
}

#[tokio::test]
async fn undoing_an_edit_that_cleared_agentic_puts_the_flag_back() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let task = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            agentic: Some(TaskAgentic::Yes),
            ..task_request("project", project_id, "hand this to an agent")
        },
    )
    .await
    .expect("create task");
    assert_eq!(agentic(&pool, task.id).await, Some(true));

    open_gesture(&app).await;
    task_commands::update_task(
        app.state(),
        task.id,
        UpdateTaskRequest {
            agentic: Some(TaskAgentic::Inherit),
            ..Default::default()
        },
    )
    .await
    .expect("clear the flag back to inheriting");
    close_gesture(&app).await;
    assert_eq!(agentic(&pool, task.id).await, None);

    undo(&app).await.expect("there is something to undo");
    assert_eq!(
        agentic(&pool, task.id).await,
        Some(true),
        "undo must put the flag back, not leave the Task inheriting a decision it had overridden"
    );

    redo(&app).await.expect("there is something to redo");
    assert_eq!(
        agentic(&pool, task.id).await,
        None,
        "and redo must clear it again"
    );
}

/// The `bd` issue link as the database holds it, read straight off the table.
async fn beads_id(pool: &SqlitePool, task_id: i64) -> Option<String> {
    sqlx::query_scalar("SELECT beads_id FROM tasks WHERE id = ?")
        .bind(task_id)
        .fetch_one(pool)
        .await
        .expect("read beads_id")
}

#[tokio::test]
async fn undoing_a_cleared_issue_link_puts_the_id_back() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let task = task_commands::create_task(
        app.state(),
        task_request("project", project_id, "tracked in bd"),
    )
    .await
    .expect("create task");

    // Established the only way a link is ever established: through the MCP server. That write is
    // agent-sourced and deliberately not on the user's stack, so the undo below can only be
    // reversing the user's clear.
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));
    mcp.beads(Parameters(params::BeadsOperation::Set {
        node_type: params::BeadsNode::Task,
        node_id: task.id,
        beads_id: Some("Arlesh-ncy".into()),
    }))
    .await
    .expect("link the task to its issue");
    assert_eq!(beads_id(&pool, task.id).await, Some("Arlesh-ncy".into()));

    open_gesture(&app).await;
    clear_beads_id(app.state(), "task".into(), task.id)
        .await
        .expect("clear the link");
    close_gesture(&app).await;
    assert_eq!(
        beads_id(&pool, task.id).await,
        None,
        "the × writes NULL, not an empty string"
    );

    undo(&app).await.expect("there is something to undo");
    assert_eq!(
        beads_id(&pool, task.id).await,
        Some("Arlesh-ncy".into()),
        "the clear is a user-sourced write, so Ctrl+Z puts the link back — the reason it needs no \
         confirmation dialog"
    );

    redo(&app).await.expect("there is something to redo");
    assert_eq!(
        beads_id(&pool, task.id).await,
        None,
        "and redo drops it again"
    );
}

#[tokio::test]
async fn undoing_a_cleared_habit_completion_brings_it_back_on_the_occurrence_it_belonged_to() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);

    // A Habit whose one item has two cycle pairs: morning and evening, two separate things to
    // complete on the same day, told apart only by `cycle_id`.
    let flow = helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .flows()
        .create(CreateFlowRequest {
            title: "Routine".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("day".into()),
            ..Default::default()
        })
        .await
        .expect("create flow");
    let item = helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .flows()
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Stretch".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        })
        .await
        .expect("create flow task");
    let pair = |index: i64| FlowCycleInput {
        scope_kind: Some("part_of_day".into()),
        scope_index: Some(index),
        ..Default::default()
    };
    helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .flows()
        .set_cycles(
            flow.id,
            FlowItemType::FlowTask,
            item.id,
            &[pair(1), pair(4)],
        )
        .await
        .expect("set cycles");
    let pairs: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM flow_item_cycles WHERE item_type = 'flow_task' AND item_id = ? \
          ORDER BY position",
    )
    .bind(item.id)
    .fetch_all(&pool)
    .await
    .expect("read the cycle pairs");
    let evening = *pairs.last().expect("the item has two pairs");

    let iteration_scope_id = helpers::session_factory(&pool)
        .connect()
        .await
        .expect("connect")
        .scopes()
        .get_or_create(
            ScopeKind::Day,
            chrono::NaiveDate::from_ymd_opt(2026, 1, 5).expect("a real date"),
        )
        .await
        .expect("the day scope")
        .id;
    let instance = || HabitInstanceRef {
        item_type: "flow_task".into(),
        item_id: item.id,
        iteration_scope_id,
        cycle_id: evening,
    };

    // The evening occurrence is completed...
    flow_commands::set_habit_item_status(
        app.state(),
        flow.id,
        instance(),
        Some("done".into()),
        1_767_600_000_000,
        None,
    )
    .await
    .expect("mark the evening occurrence done");

    // ...and then un-completed, which deletes the Modification row, inside a gesture.
    open_gesture(&app).await;
    flow_commands::set_habit_item_status(app.state(), flow.id, instance(), None, 0, None)
        .await
        .expect("clear the status");
    close_gesture(&app).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM habit_instance_modifications")
            .fetch_one(&pool)
            .await
            .expect("count"),
        0,
        "clearing a status removes the Modification row"
    );

    undo(&app).await.expect("there is something to undo");
    let restored: (i64, Option<String>) = sqlx::query_as(
        "SELECT cycle_id, status FROM habit_instance_modifications WHERE item_id = ?",
    )
    .bind(item.id)
    .fetch_one(&pool)
    .await
    .expect("the Modification is back");
    assert_eq!(
        restored,
        (evening, Some("done".into())),
        "the completion must come back on the evening occurrence, not on the no-pair sentinel: a \
         restored cycle_id of 0 marks an occurrence the user never completed and leaves the one \
         they did outstanding"
    );
}

// ---------------------------------------------------------------------------------------------
// A failure is reported, never half-applied.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn an_undo_that_cannot_be_applied_changes_nothing_and_leaves_the_gesture_on_the_stack() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool, "doomed-tag").await;
    let task =
        task_commands::create_task(app.state(), task_request("project", project_id, "tagged"))
            .await
            .expect("create task");
    task_commands::add_tag_to_task(app.state(), task.id, tag_id)
        .await
        .expect("tag the task");

    // The user removes the tag, inside a gesture...
    open_gesture(&app).await;
    task_commands::remove_tag_from_task(app.state(), task.id, tag_id)
        .await
        .expect("remove the tag");
    let doomed = close_gesture(&app).await.expect("the gesture is undoable");

    // ...and then the task itself goes, with no gesture open, so it is not on the stack. Putting
    // the tag link back now means a row whose `task_id` references nothing: a real foreign-key
    // failure, not an injected one.
    task_commands::delete_task(app.state(), task.id)
        .await
        .expect("delete the task");
    let before = board(&pool).await;

    let error = undo_commands::undo(helpers::window(&app), app.state(), app.state())
        .await
        .expect_err("the inverse cannot be applied");
    let reported = serde_json::to_value(&error).expect("the error serialises to the frontend");
    let message = reported["message"].as_str().unwrap_or_default();
    assert!(
        message.contains(&doomed.gesture.0),
        "the user has to be told which gesture could not be applied, got {message:?}"
    );

    assert_eq!(
        board(&pool).await,
        before,
        "a failed undo leaves the board exactly as it was"
    );
    assert_eq!(
        undo_commands::undo_status(app.state())
            .await
            .expect("status")
            .undo
            .map(|offered| offered.gesture),
        Some(doomed.gesture),
        "and the gesture stays on the stack, so the press can be tried again"
    );
}

/// The `asynchronous` flag as the database holds it.
async fn asynchronous(pool: &SqlitePool, task_id: i64) -> bool {
    sqlx::query_scalar("SELECT asynchronous FROM tasks WHERE id = ?")
        .bind(task_id)
        .fetch_one(pool)
        .await
        .expect("read asynchronous")
}

#[tokio::test]
async fn undoing_an_edit_that_unflagged_asynchronous_puts_the_flag_back() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let task = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            asynchronous: Some(true),
            ..task_request("project", project_id, "order the casting")
        },
    )
    .await
    .expect("create task");
    assert!(asynchronous(&pool, task.id).await);

    open_gesture(&app).await;
    task_commands::update_task(
        app.state(),
        task.id,
        UpdateTaskRequest {
            asynchronous: Some(false),
            ..Default::default()
        },
    )
    .await
    .expect("unflag the task");
    close_gesture(&app).await;
    assert!(!asynchronous(&pool, task.id).await);

    undo(&app).await.expect("there is something to undo");
    assert!(
        asynchronous(&pool, task.id).await,
        "undo must put the flag back — a column the triggers do not name is restored silently \
         as whatever it was at insert time"
    );

    redo(&app).await.expect("there is something to redo");
    assert!(
        !asynchronous(&pool, task.id).await,
        "and redo must clear it again"
    );
}

/// How many completed checks are stored for a wait.
async fn completed_checks(pool: &SqlitePool, expectation_id: i64) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM wait_checks WHERE wait_kind = 'stored' AND wait_id = ?",
    )
    .bind(expectation_id)
    .fetch_one(pool)
    .await
    .expect("read the checks")
}

#[tokio::test]
async fn undoing_a_completed_check_reopens_it_and_redo_completes_it_again() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let wait = arlesh_lib::commands::expectations::create_expectation(
        app.state(),
        arlesh_lib::tasks::model::CreateExpectationRequest {
            title: "reviewer replies".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            check_every: Some(arlesh_lib::tasks::model::DurationSpec {
                n: 1,
                kind: "day".into(),
            }),
            // Long past, so a check is due whenever the test runs.
            check_starting: chrono::NaiveDate::from_ymd_opt(2026, 1, 1)
                .and_then(|date| date.and_hms_opt(2, 0, 0)),
            time_scope: None,
        },
    )
    .await
    .expect("create the wait");

    open_gesture(&app).await;
    arlesh_lib::commands::expectations::complete_expectation_check(app.state(), wait.id)
        .await
        .expect("complete the check");
    close_gesture(&app).await;
    assert_eq!(completed_checks(&pool, wait.id).await, 1);

    undo(&app).await.expect("there is something to undo");
    assert_eq!(
        completed_checks(&pool, wait.id).await,
        0,
        "undo reopens the check"
    );
    redo(&app).await.expect("there is something to redo");
    assert_eq!(
        completed_checks(&pool, wait.id).await,
        1,
        "and redo completes it again"
    );
}
