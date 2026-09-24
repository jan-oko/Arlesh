//! The MCP roots, end to end: what the tools let an agent see and write, what the instructions
//! tell it, and how the roots themselves are stored.
//!
//! The rules are pinned in `access::resolve`'s unit tests; these prove each tool applies them —
//! omitting on the way out, refusing on the way in — and that the roots are an ordinary undoable
//! part of the board.

use crate::helpers;

use arlesh_lib::access::model::NodeTable;
use arlesh_lib::commands::{
    access as access_commands, domains as domain_commands, tasks as task_commands,
    undo as undo_commands,
};
use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype};
use arlesh_lib::mcp::{params, ArleshMcp};
use arlesh_lib::tasks::model::{CreateTaskRequest, Dependency};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use tauri::test::MockRuntime;
use tauri::{App, Manager};

/// Two projects under the first Aspect, each holding one task. Nothing is an MCP root yet.
struct Board {
    inside: i64,
    outside: i64,
    inside_task: i64,
    outside_task: i64,
}

async fn project(app: &App<MockRuntime>, title: &str) -> i64 {
    domain_commands::create_domain(
        app.state(),
        CreateDomainRequest {
            title: title.into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(1),
            status: None,
            knowledge_base_directory: None,
        },
    )
    .await
    .expect("create project")
    .id
}

async fn task(app: &App<MockRuntime>, project_id: i64, title: &str) -> i64 {
    task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: title.into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .expect("create task")
    .id
}

async fn board(app: &App<MockRuntime>) -> Board {
    let inside = project(app, "Opened").await;
    let outside = project(app, "Closed").await;
    Board {
        inside,
        outside,
        inside_task: task(app, inside, "Visible work").await,
        outside_task: task(app, outside, "Hidden work").await,
    }
}

async fn add_root(app: &App<MockRuntime>, kind: NodeTable, id: i64) {
    access_commands::add_mcp_root(app.state(), kind, id)
        .await
        .expect("add MCP root");
}

fn mcp(pool: &sqlx::SqlitePool) -> ArleshMcp {
    ArleshMcp::new(helpers::session_factory(pool))
}

fn now() -> chrono::NaiveDateTime {
    chrono::NaiveDate::from_ymd_opt(2026, 2, 4)
        .and_then(|day| day.and_hms_opt(9, 0, 0))
        .expect("a valid instant")
}

fn structured(result: &CallToolResult) -> &serde_json::Value {
    result
        .structured_content
        .as_ref()
        .expect("the tool result carried no structured content")
}

fn kind_of_error(result: &CallToolResult) -> Option<&str> {
    assert_eq!(
        result.is_error,
        Some(true),
        "expected an error, got {:?}",
        result.structured_content
    );
    structured(result)
        .get("kind")
        .and_then(|kind| kind.as_str())
}

fn ids(payload: &serde_json::Value, section: &str) -> Vec<i64> {
    payload
        .get(section)
        .and_then(|items| items.as_array())
        .unwrap_or_else(|| panic!("the snapshot carried no {section}"))
        .iter()
        .filter_map(|item| item.get("id").and_then(|id| id.as_i64()))
        .collect()
}

async fn snapshot(mcp: &ArleshMcp) -> serde_json::Value {
    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: now(),
            sections: None,
            cursor: None,
            filter: None,
        }))
        .await
        .expect("the snapshot tool returned no result");
    assert_ne!(
        result.is_error,
        Some(true),
        "{:?}",
        result.structured_content
    );
    structured(&result).clone()
}

async fn get_task(mcp: &ArleshMcp, id: i64) -> CallToolResult {
    mcp.tasks(Parameters(params::TasksOperation::Get { id }))
        .await
        .expect("the tasks tool returned no result")
}

async fn set_beads(mcp: &ArleshMcp, task_id: i64) -> CallToolResult {
    mcp.beads(Parameters(params::BeadsOperation::Set {
        node_type: params::BeadsNode::Task,
        node_id: task_id,
        beads_id: Some("Arlesh-rz0".into()),
    }))
    .await
    .expect("the beads tool returned no result")
}

#[tokio::test]
async fn with_no_roots_the_mcp_sees_an_empty_board() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let mcp = mcp(&pool);

    let payload = snapshot(&mcp).await;

    for section in ["domains", "goals", "tasks", "flows", "lifecycles"] {
        assert_eq!(
            payload.get(section),
            Some(&serde_json::json!([])),
            "{section} with no MCP roots"
        );
    }
    assert_eq!(
        kind_of_error(&get_task(&mcp, board.inside_task).await),
        Some("not_permitted")
    );
}

#[tokio::test]
async fn a_root_opens_its_subtree_and_nothing_beside_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    add_root(&app, NodeTable::Domain, board.inside).await;
    let mcp = mcp(&pool);

    let payload = snapshot(&mcp).await;

    assert_eq!(ids(&payload, "domains"), vec![board.inside]);
    assert_eq!(ids(&payload, "tasks"), vec![board.inside_task]);
    assert_ne!(get_task(&mcp, board.inside_task).await.is_error, Some(true));
    assert_eq!(
        kind_of_error(&get_task(&mcp, board.outside_task).await),
        Some("not_permitted")
    );
    assert!(
        !payload.to_string().contains("Hidden work"),
        "nothing outside the root may leak into the payload"
    );
}

#[tokio::test]
async fn a_relation_to_a_node_outside_the_roots_is_cut() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    task_commands::add_task_dependency(
        app.state(),
        board.inside_task,
        Dependency::Task {
            id: board.outside_task,
        },
    )
    .await
    .expect("add dependency");
    add_root(&app, NodeTable::Domain, board.inside).await;
    let mcp = mcp(&pool);

    let payload = snapshot(&mcp).await;
    assert_eq!(
        payload.get("task_dependencies"),
        Some(&serde_json::json!([]))
    );

    let got = get_task(&mcp, board.inside_task).await;
    assert_ne!(got.is_error, Some(true), "{:?}", got.structured_content);
    assert_eq!(
        structured(&got).get("block_reasons"),
        Some(&serde_json::json!([])),
        "the derived reason names the hidden task, so it goes with it"
    );
}

#[tokio::test]
async fn a_private_node_stays_hidden_inside_a_root() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let diary = task(&app, board.inside, "Diary").await;
    sqlx::query("UPDATE tasks SET is_private = 1 WHERE id = ?")
        .bind(diary)
        .execute(&pool)
        .await
        .expect("mark private");
    add_root(&app, NodeTable::Domain, board.inside).await;
    let mcp = mcp(&pool);

    let payload = snapshot(&mcp).await;

    assert_eq!(ids(&payload, "tasks"), vec![board.inside_task]);
    assert_eq!(
        kind_of_error(&get_task(&mcp, diary).await),
        Some("not_permitted")
    );
}

#[tokio::test]
async fn only_an_agentic_task_inside_a_root_can_be_written() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    add_root(&app, NodeTable::Domain, board.inside).await;
    let mcp = mcp(&pool);

    assert_eq!(
        kind_of_error(&set_beads(&mcp, board.inside_task).await),
        Some("not_permitted"),
        "readable but not Agentic"
    );

    helpers::make_agentic(&pool, board.outside_task).await;
    assert_eq!(
        kind_of_error(&set_beads(&mcp, board.outside_task).await),
        Some("not_permitted"),
        "Agentic but outside every root"
    );

    helpers::make_agentic(&pool, board.inside_task).await;
    let written = set_beads(&mcp, board.inside_task).await;
    assert_ne!(
        written.is_error,
        Some(true),
        "{:?}",
        written.structured_content
    );
}

#[tokio::test]
async fn a_task_under_an_agentic_task_inherits_write() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let step = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Step".into(),
            parent_type: "task".into(),
            parent_id: board.inside_task,
            ..Default::default()
        },
    )
    .await
    .expect("create subtask")
    .id;
    helpers::make_agentic(&pool, board.inside_task).await;
    add_root(&app, NodeTable::Domain, board.inside).await;

    let written = set_beads(&mcp(&pool), step).await;

    assert_ne!(
        written.is_error,
        Some(true),
        "{:?}",
        written.structured_content
    );
}

#[tokio::test]
async fn a_person_is_visible_only_through_a_visible_task() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let mut people = Vec::new();
    for (name, task_id) in [("Seen", board.inside_task), ("Unseen", board.outside_task)] {
        let person = arlesh_lib::commands::knowledge_base::create_person(
            app.state(),
            arlesh_lib::knowledge_base::model::CreatePersonRequest {
                name: name.into(),
                aliases: None,
                linked_note: None,
            },
        )
        .await
        .expect("create person");
        sqlx::query("UPDATE tasks SET delegate_kind = 'person', delegate_id = ? WHERE id = ?")
            .bind(person.id)
            .bind(task_id)
            .execute(&pool)
            .await
            .expect("delegate");
        people.push(person.id);
    }
    add_root(&app, NodeTable::Domain, board.inside).await;
    let mcp = mcp(&pool);

    let listed = mcp
        .kb(Parameters(params::KbOperation::ListPeople))
        .await
        .expect("the kb tool returned no result");
    let names: Vec<&str> = structured(&listed)
        .as_array()
        .expect("a list of people")
        .iter()
        .filter_map(|person| person.get("name").and_then(|name| name.as_str()))
        .collect();
    assert_eq!(names, vec!["Seen"]);

    let unseen = mcp
        .kb(Parameters(params::KbOperation::GetPerson { id: people[1] }))
        .await
        .expect("the kb tool returned no result");
    assert_eq!(kind_of_error(&unseen), Some("not_permitted"));
}

#[tokio::test]
async fn the_instructions_name_each_visible_root() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let mcp = mcp(&pool);

    let closed = mcp.instructions().await;
    assert!(closed.contains("arlesh_snapshot.load"), "{closed}");
    assert!(closed.contains("MCP ROOTS: none."), "{closed}");

    add_root(&app, NodeTable::Domain, board.inside).await;
    add_root(&app, NodeTable::Task, board.outside_task).await;

    let open = mcp.instructions().await;
    assert!(
        open.contains(&format!("› Opened (project {})", board.inside)),
        "{open}"
    );
    assert!(
        open.contains(&format!(
            "› Closed › Hidden work (task {})",
            board.outside_task
        )),
        "{open}"
    );
}

#[tokio::test]
async fn the_access_list_names_the_root_each_node_is_seen_through() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    add_root(&app, NodeTable::Domain, board.inside).await;

    let access = serde_json::to_value(
        access_commands::list_mcp_access(app.state())
            .await
            .expect("list MCP access"),
    )
    .expect("serialise");

    assert_eq!(
        access,
        serde_json::json!([
            { "node_kind": "domain", "node_id": board.inside,
              "root_kind": "domain", "root_id": board.inside },
            { "node_kind": "task", "node_id": board.inside_task,
              "root_kind": "domain", "root_id": board.inside },
        ])
    );
}

#[tokio::test]
async fn adding_a_root_is_one_undoable_step() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;

    undo_commands::open_gesture(app.state())
        .await
        .expect("open gesture");
    add_root(&app, NodeTable::Domain, board.inside).await;
    undo_commands::close_gesture(helpers::window(&app), app.state(), app.state())
        .await
        .expect("close gesture");
    assert_eq!(roots(&app).await.len(), 1);

    undo_commands::undo(helpers::window(&app), app.state(), app.state())
        .await
        .expect("undo");

    assert!(roots(&app).await.is_empty());
}

#[tokio::test]
async fn deleting_a_root_node_drops_the_root_and_undo_brings_both_back() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    add_root(&app, NodeTable::Task, board.inside_task).await;

    undo_commands::open_gesture(app.state())
        .await
        .expect("open gesture");
    task_commands::delete_task(app.state(), board.inside_task)
        .await
        .expect("delete task");
    undo_commands::close_gesture(helpers::window(&app), app.state(), app.state())
        .await
        .expect("close gesture");
    assert!(
        roots(&app).await.is_empty(),
        "a root on a deleted row would open whatever reuses its id"
    );

    undo_commands::undo(helpers::window(&app), app.state(), app.state())
        .await
        .expect("undo");

    assert_eq!(
        serde_json::to_value(roots(&app).await).expect("serialise"),
        serde_json::json!([{ "node_kind": "task", "node_id": board.inside_task }])
    );
}

#[tokio::test]
async fn a_root_on_a_node_that_does_not_exist_is_refused() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);

    let refused = access_commands::add_mcp_root(app.state(), NodeTable::Task, 99_999)
        .await
        .expect_err("a root on nothing");

    assert_eq!(
        serde_json::to_value(refused).expect("serialise")["kind"],
        "not_found"
    );
}

async fn roots(app: &App<MockRuntime>) -> Vec<arlesh_lib::access::model::NodeKey> {
    access_commands::mcp_access_catalogue(app.state())
        .await
        .expect("read the MCP access catalogue")
        .roots
}
