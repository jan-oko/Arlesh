//! Integration tests for the board-changed broadcast.
//!
//! The contract is that **an edit made in one window reaches the others**, and the thing most
//! likely to rot is where that announcement comes from. Arlesh does not put a line at the end of
//! each of its 83 mutating commands — see `crate::board` for why — it derives the announcement from
//! the Undo Journal those commands already write. So what these tests hold down is that
//! derivation: a Gesture that wrote says so, a Gesture that only read does not, and the two writes
//! the journal cannot see say so themselves.
//!
//! The obligation that used to belong to each command now belongs to the journal, and
//! `tests/undo_journal.rs` already fails for any table whose writes are not journaled. A new
//! command therefore cannot forget to announce without first forgetting to be undoable, which is a
//! failure the suite already catches.

mod helpers;

use arlesh_lib::board::recipients;
use arlesh_lib::commands::tasks as task_commands;
use arlesh_lib::commands::undo as undo_commands;
use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus};
use arlesh_lib::mcp::{params, ArleshMcp};
use arlesh_lib::tasks::model::CreateTaskRequest;
use arlesh_lib::undo::model::WriteSource;
use arlesh_lib::undo::{self as engine, GestureClose};
use rmcp::handler::server::wrapper::Parameters;
use sqlx::SqlitePool;
use tauri::test::MockRuntime;
use tauri::{App, Manager};

/// Opens a Gesture through the command, as the frontend's `invoke` wrapper does for every command.
async fn open(app: &App<MockRuntime>) {
    undo_commands::open_gesture(app.state())
        .await
        .expect("open gesture");
}

/// Closes one, straight off the engine, so the test can read both halves of the answer.
async fn close(app: &App<MockRuntime>) -> GestureClose {
    engine::close_gesture(
        &app.state::<arlesh_lib::database::session::SessionFactory>(),
        &app.state::<arlesh_lib::undo::stacks::UndoStacks>(),
    )
    .await
    .expect("close gesture")
}

/// A project to hang tasks off, created outside any Gesture.
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
            title: "Broadcast Project".into(),
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

/// Creates a task through the real command, inside whatever Gesture is open.
async fn create_task(app: &App<MockRuntime>, project_id: i64, title: &str) -> i64 {
    task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: title.into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            time_scope: None,
            on_scope_exit: None,
            plan: None,
            archival: None,
            agentic: None,
            asynchronous: None,
            async_template: None,
        },
    )
    .await
    .expect("create task")
    .id
}

#[tokio::test]
async fn a_gesture_that_wrote_says_the_board_changed() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    open(&app).await;
    create_task(&app, project_id, "Announce me").await;
    let closed = close(&app).await;

    assert!(closed.wrote, "a create has to reach the other windows");
    assert!(
        closed.undoable.is_some(),
        "and it is the user's own, so Ctrl+Z takes it back"
    );
}

#[tokio::test]
async fn a_gesture_that_only_read_says_nothing() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    make_project(&pool).await;

    open(&app).await;
    task_commands::list_tasks(app.state())
        .await
        .expect("list tasks");
    let closed = close(&app).await;

    assert!(
        !closed.wrote,
        "every read goes through the Gesture wrapper too; none of them is a board change"
    );
    assert!(closed.undoable.is_none());
}

#[tokio::test]
async fn a_nested_close_announces_nothing_and_the_outer_one_announces_once() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    // The shape `withGesture` produces: an outer open, then a command's own open and close.
    open(&app).await;
    open(&app).await;
    create_task(&app, project_id, "Inside a run").await;
    let inner = close(&app).await;
    let outer = close(&app).await;

    assert!(
        !inner.wrote,
        "a nested close ends nothing, so it must not announce a change that is still in flight"
    );
    assert!(outer.wrote, "the close that ends the Gesture announces it");
}

#[tokio::test]
async fn an_agents_write_reaches_the_windows_even_though_it_never_reaches_the_undo_stack() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let task_id = create_task(&app, project_id, "Linked by an agent").await;

    open(&app).await;
    {
        let mut db = helpers::session_factory(&pool)
            .begin()
            .await
            .expect("begin");
        let previous = db
            .undo()
            .set_source(WriteSource::Mcp)
            .await
            .expect("set source");
        db.tasks()
            .set_beads_id(
                arlesh_lib::tasks::model::TaskId(task_id),
                Some("Arlesh-fxo".into()),
            )
            .await
            .expect("set beads id");
        db.undo()
            .set_source(previous)
            .await
            .expect("restore source");
        db.commit().await.expect("commit");
    }
    let closed = close(&app).await;

    assert!(
        closed.wrote,
        "a window showing that node is now wrong, whoever made the write"
    );
    assert!(
        closed.undoable.is_none(),
        "and Ctrl+Z still must not reverse something the user did not do"
    );
}

#[tokio::test]
async fn the_mcp_tool_that_writes_announces_after_it_commits() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let task_id = create_task(&app, project_id, "Linked over MCP").await;

    let announced = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = announced.clone();
    let mcp = ArleshMcp::new(helpers::session_factory(&pool)).announcing(std::sync::Arc::new(
        move |_origin: Option<&str>| {
            counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        },
    ));

    mcp.beads(Parameters(params::BeadsOperation::Set {
        node_type: params::BeadsNode::Task,
        node_id: task_id,
        beads_id: Some("Arlesh-fxo".into()),
    }))
    .await
    .expect("the beads tool");

    assert_eq!(
        announced.load(std::sync::atomic::Ordering::Relaxed),
        1,
        "the one MCP write the server has must refresh an open window"
    );
}

#[tokio::test]
async fn an_mcp_refusal_announces_nothing() {
    let pool = helpers::test_pool().await;
    let _app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    let announced = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = announced.clone();
    let mcp = ArleshMcp::new(helpers::session_factory(&pool)).announcing(std::sync::Arc::new(
        move |_origin: Option<&str>| {
            counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        },
    ));

    // A Project id offered as a Task: the tool refuses, and nothing was written to tell anyone of.
    let _ = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: project_id + 9_000,
            beads_id: Some("Arlesh-fxo".into()),
        }))
        .await;

    assert_eq!(
        announced.load(std::sync::atomic::Ordering::Relaxed),
        0,
        "a write that did not happen is not a board change"
    );
}

#[tokio::test]
async fn an_undo_announces_even_though_it_writes_no_journal() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    open(&app).await;
    create_task(&app, project_id, "To be taken back").await;
    close(&app).await;

    // The replay runs with journalling suppressed, so the journal has nothing to report — which is
    // exactly why the command announces for itself. What the test can hold down without a second
    // real window is that the replay applied, which is the condition the announcement is on.
    let applied = undo_commands::undo(helpers::window(&app), app.state(), app.state())
        .await
        .expect("undo");
    assert!(applied.is_some(), "an undo that applied announces");

    let nothing = undo_commands::undo(helpers::window(&app), app.state(), app.state())
        .await
        .expect("undo");
    assert!(nothing.is_none(), "an empty stack announces nothing");
}

#[test]
fn a_change_reaches_every_window_but_the_one_that_made_it() {
    let open: Vec<String> = ["main", "board-a", "board-b"]
        .iter()
        .map(|label| (*label).to_string())
        .collect();

    assert_eq!(recipients(&open, Some("main")), vec!["board-a", "board-b"]);
    assert!(recipients(&open[..1], Some("main")).is_empty());
}

#[tokio::test]
async fn an_abort_that_took_everything_back_announces_nothing() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    open(&app).await;
    create_task(&app, project_id, "Never mind").await;
    let aborted = engine::abort_gesture(
        &app.state::<arlesh_lib::database::session::SessionFactory>(),
        &app.state::<arlesh_lib::undo::stacks::UndoStacks>(),
    )
    .await
    .expect("abort gesture");

    assert!(
        aborted.taken_back.is_some(),
        "the create was the user's, so the abort reverses it"
    );
    assert!(
        !aborted.wrote,
        "the board is back where it was, so there is nothing to tell the other windows"
    );
}

#[tokio::test]
async fn an_abort_still_announces_an_agents_write_it_could_not_take_back() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let task_id = create_task(&app, project_id, "Linked mid-gesture").await;

    open(&app).await;
    create_task(&app, project_id, "Never mind").await;
    {
        let mut db = helpers::session_factory(&pool)
            .begin()
            .await
            .expect("begin");
        let previous = db
            .undo()
            .set_source(WriteSource::Mcp)
            .await
            .expect("set source");
        db.tasks()
            .set_beads_id(
                arlesh_lib::tasks::model::TaskId(task_id),
                Some("Arlesh-fxo".into()),
            )
            .await
            .expect("set beads id");
        db.undo()
            .set_source(previous)
            .await
            .expect("restore source");
        db.commit().await.expect("commit");
    }

    let aborted = engine::abort_gesture(
        &app.state::<arlesh_lib::database::session::SessionFactory>(),
        &app.state::<arlesh_lib::undo::stacks::UndoStacks>(),
    )
    .await
    .expect("abort gesture");

    assert!(
        aborted.wrote,
        "an abort takes back the user's writes; an agent's was never this Gesture's to reverse, \
         so it stands and the other windows still have to hear about it"
    );
}
