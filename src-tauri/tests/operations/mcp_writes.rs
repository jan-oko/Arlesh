//! The MCP's task writes and short ids, end to end: who may create, edit, re-status, move and
//! archive what; the status compare-and-set; and naming a node by a short id.
//!
//! Writes to a Habit occurrence are in `tests/flows/agentic_occurrences.rs`, beside the fixtures
//! that derive one.

use crate::helpers;
use helpers::StoredId;

use arlesh_lib::access::model::NodeTable;
use arlesh_lib::commands::{
    access as access_commands, domains as domain_commands, tasks as task_commands,
    undo as undo_commands,
};
use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype};
use arlesh_lib::mcp::{params, ArleshMcp};
use arlesh_lib::nodes::id::{uuid_v5, NODE_NAMESPACE};
use arlesh_lib::tasks::model::{AgenticPriority, CreateGoalRequest, CreateTaskRequest};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use tauri::test::MockRuntime;
use tauri::{App, Manager};

use params::{NodeIdParam, TaskStatusParam, TasksOperation};

/// A project opened to the MCP and one that is not, each holding a Task that inherits nothing.
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

async fn task(app: &App<MockRuntime>, parent_type: &str, parent_id: i64, title: &str) -> i64 {
    task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: title.into(),
            parent_type: parent_type.into(),
            parent_id: parent_id.into(),
            ..Default::default()
        },
    )
    .await
    .expect("create task")
    .id
    .sid()
}

async fn board(app: &App<MockRuntime>) -> Board {
    let inside = project(app, "Opened").await;
    let outside = project(app, "Closed").await;
    access_commands::add_mcp_root(app.state(), NodeTable::Domain, inside)
        .await
        .expect("add MCP root");
    Board {
        inside,
        outside,
        inside_task: task(app, "project", inside, "Visible work").await,
        outside_task: task(app, "project", outside, "Hidden work").await,
    }
}

fn mcp(pool: &sqlx::SqlitePool) -> ArleshMcp {
    ArleshMcp::new(helpers::session_factory(pool))
}

async fn set_column(pool: &sqlx::SqlitePool, sql: &str, id: i64) {
    sqlx::query(sql)
        .bind(id)
        .execute(pool)
        .await
        .expect("write the fixture column");
}

async fn not_agentic(pool: &sqlx::SqlitePool, id: i64) {
    set_column(pool, "UPDATE tasks SET agentic = 0 WHERE id = ?", id).await;
}

async fn run(mcp: &ArleshMcp, operation: TasksOperation) -> CallToolResult {
    mcp.tasks(Parameters(operation))
        .await
        .expect("the tasks tool returned no result")
}

fn body(result: &CallToolResult) -> &serde_json::Value {
    result
        .structured_content
        .as_ref()
        .expect("the tool result carried no structured content")
}

fn succeeded(result: &CallToolResult) -> &serde_json::Value {
    assert_ne!(
        result.is_error,
        Some(true),
        "{:?}",
        result.structured_content
    );
    body(result)
}

fn refused(result: &CallToolResult) -> &str {
    assert_eq!(
        result.is_error,
        Some(true),
        "expected a refusal, got {:?}",
        result.structured_content
    );
    body(result)["kind"].as_str().unwrap_or("")
}

fn create(parent_type: &str, parent_id: impl Into<NodeIdParam>, title: &str) -> TasksOperation {
    operation(serde_json::json!({
        "operation": "create",
        "parent_type": parent_type,
        "parent_id": parent_id.into().text(),
        "title": title,
    }))
}

/// An operation as an agent sends it, read through the wire's own parsing.
fn operation(value: serde_json::Value) -> TasksOperation {
    serde_json::from_value(value).expect("a well-formed operation")
}

fn with_spec(spec: &str) -> params::BriefParam {
    params::BriefParam {
        priority: Some(Some(AgenticPriority::B)),
        spec: Some(Some(spec.into())),
        ..Default::default()
    }
}

/// An update of the row fields the first task writes took, every other field left out.
fn edit(
    id: impl Into<NodeIdParam>,
    title: Option<&str>,
    brief: Option<params::BriefParam>,
    backlog: Option<bool>,
) -> TasksOperation {
    TasksOperation::Update {
        id: id.into(),
        title: title.map(str::to_string),
        brief,
        backlog,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        asynchronous: None,
        add_dependencies: Vec::new(),
        remove_dependencies: Vec::new(),
        add_tags: Vec::new(),
        remove_tags: Vec::new(),
        block_reasons: None,
    }
}

fn retitle(id: impl Into<NodeIdParam>, title: &str) -> TasksOperation {
    edit(id, Some(title), None, None)
}

async fn status_of(pool: &sqlx::SqlitePool, id: i64) -> String {
    sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("read the status")
}

async fn title_of(pool: &sqlx::SqlitePool, id: i64) -> String {
    sqlx::query_scalar("SELECT title FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("read the title")
}

/// The snapshot's rows of `section`.
async fn snapshot(mcp: &ArleshMcp, section: &str) -> Vec<serde_json::Value> {
    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: None,
            sections: None,
            cursor: None,
            filter: None,
            agentic: None,
        }))
        .await
        .expect("the snapshot tool returned no result");
    succeeded(&result)[section]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

async fn short_id(mcp: &ArleshMcp, section: &str, id: i64) -> String {
    snapshot(mcp, section)
        .await
        .into_iter()
        .find(|row| row["id"] == id)
        .and_then(|row| row["short_id"].as_str().map(str::to_string))
        .unwrap_or_else(|| panic!("{section} {id} carries no short id"))
}

#[tokio::test]
async fn an_agent_creates_an_agentic_task_inside_a_root() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let mcp = mcp(&pool);

    let created = run(
        &mcp,
        operation(serde_json::json!({
            "operation": "create",
            "parent_type": "project",
            "parent_id": board.inside.to_string(),
            "title": "Write the parser",
            "brief": { "priority": "B", "spec": "Parse the config file" },
        })),
    )
    .await;

    let created = succeeded(&created).clone();
    assert_eq!(created["agentic"], true, "what an agent creates is Agentic");
    assert_eq!(created["agentic_brief"]["spec"], "Parse the config file");
    assert_eq!(created["agentic_brief"]["priority"], "B");
    let id = created["id"].as_i64().expect("a stored row");
    assert_eq!(
        created["full_id"],
        uuid_v5(&NODE_NAMESPACE, &format!("task:{id}"))
    );
    assert_eq!(
        created["short_id"].as_str(),
        Some(short_id(&mcp, "tasks", id).await.as_str()),
        "the short id it is given is the one the snapshot then shows"
    );
    let source: String = sqlx::query_scalar(
        "SELECT source FROM undo_journal WHERE table_name = 'tasks' ORDER BY seq DESC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .expect("the task was journaled");
    assert_eq!(source, "mcp");
}

#[tokio::test]
async fn creating_is_refused_outside_the_roots_and_under_a_task_marked_not_agentic() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let marked = task(&app, "project", board.inside, "The user's own").await;
    not_agentic(&pool, marked).await;
    let mcp = mcp(&pool);

    let outside = run(&mcp, create("project", board.outside, "Sneak in")).await;
    assert_eq!(refused(&outside), "not_permitted");
    let under_marked = run(&mcp, create("task", marked, "Take over")).await;
    assert_eq!(refused(&under_marked), "not_permitted");
    let under_hidden = run(&mcp, create("task", board.outside_task, "Sneak in")).await;
    assert_eq!(refused(&under_hidden), "not_permitted");

    let under_plain = run(&mcp, create("task", board.inside_task, "A step")).await;
    assert_eq!(
        succeeded(&under_plain)["parent_id"],
        board.inside_task,
        "a Task that merely inherits nothing is no exception"
    );
}

#[tokio::test]
async fn only_a_task_that_reads_as_agentic_is_edited() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let mcp = mcp(&pool);

    let plain = run(&mcp, retitle(board.inside_task, "Mine now")).await;
    assert_eq!(refused(&plain), "not_permitted", "readable is not writable");
    let hidden = run(&mcp, retitle(board.outside_task, "Mine now")).await;
    assert_eq!(refused(&hidden), "not_permitted");
    assert_eq!(title_of(&pool, board.inside_task).await, "Visible work");

    helpers::make_agentic(&pool, board.inside_task).await;
    let briefed = run(
        &mcp,
        edit(
            board.inside_task,
            None,
            Some(with_spec("Make it visible")),
            None,
        ),
    )
    .await;
    succeeded(&briefed);
    let noted = run(
        &mcp,
        edit(
            board.inside_task,
            Some("Visible work, briefed"),
            Some(params::BriefParam {
                notes: Some(Some("Mind the contrast".into())),
                ..Default::default()
            }),
            Some(true),
        ),
    )
    .await;

    let noted = succeeded(&noted);
    assert_eq!(noted["title"], "Visible work, briefed");
    assert_eq!(noted["archival"], "backlog");
    assert_eq!(noted["agentic_brief"]["notes"], "Mind the contrast");
    assert_eq!(
        noted["agentic_brief"]["spec"], "Make it visible",
        "a brief field left out keeps its value"
    );
}

#[tokio::test]
async fn of_two_status_writes_expecting_the_same_status_exactly_one_wins() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    helpers::make_agentic(&pool, board.inside_task).await;
    let mcp = mcp(&pool);
    succeeded(
        &run(
            &mcp,
            edit(board.inside_task, None, Some(with_spec("Race")), None),
        )
        .await,
    );
    let set = |status| TasksOperation::SetStatus {
        id: board.inside_task.into(),
        expected: TaskStatusParam::Todo,
        status,
    };

    let (started, finished) = tokio::join!(
        run(&mcp, set(TaskStatusParam::InProgress)),
        run(&mcp, set(TaskStatusParam::Done)),
    );

    let outcomes = [&started, &finished];
    let winners: Vec<&&CallToolResult> = outcomes
        .iter()
        .filter(|outcome| outcome.is_error != Some(true))
        .collect();
    assert_eq!(winners.len(), 1, "exactly one write wins");
    let loser = outcomes
        .iter()
        .find(|outcome| outcome.is_error == Some(true))
        .expect("and the other loses");
    assert_eq!(refused(loser), "status_changed");
    let now = status_of(&pool, board.inside_task).await;
    assert_eq!(body(loser)["details"]["current"], now.as_str());
    assert_eq!(
        winners[0]
            .structured_content
            .as_ref()
            .map(|task| &task["status"]),
        Some(&serde_json::json!(now))
    );
}

#[tokio::test]
async fn starting_an_agentic_task_needs_a_spec() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    helpers::make_agentic(&pool, board.inside_task).await;

    let started = run(
        &mcp(&pool),
        TasksOperation::SetStatus {
            id: board.inside_task.into(),
            expected: TaskStatusParam::Todo,
            status: TaskStatusParam::InProgress,
        },
    )
    .await;

    assert_eq!(started.is_error, Some(true));
    assert_eq!(status_of(&pool, board.inside_task).await, "todo");
}

#[tokio::test]
async fn a_task_moves_only_between_parents_it_could_be_created_under() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    helpers::make_agentic(&pool, board.inside_task).await;
    let goal = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Ship it".into(),
            parent_type: "project".into(),
            parent_id: board.inside.into(),
            ..Default::default()
        },
    )
    .await
    .expect("create goal")
    .id
    .sid();
    let marked = task(&app, "project", board.inside, "The user's own").await;
    not_agentic(&pool, marked).await;
    let mcp = mcp(&pool);
    let move_to = |parent_type: &str, parent_id: i64| TasksOperation::Move {
        id: board.inside_task.into(),
        parent_type: parent_type.into(),
        parent_id: parent_id.into(),
    };

    assert_eq!(
        refused(&run(&mcp, move_to("project", board.outside)).await),
        "not_permitted"
    );
    assert_eq!(
        refused(&run(&mcp, move_to("task", marked)).await),
        "not_permitted"
    );
    let moved = run(&mcp, move_to("goal", goal)).await;

    assert_eq!(succeeded(&moved)["parent_type"], "goal");
    assert_eq!(succeeded(&moved)["parent_id"], goal);
}

#[tokio::test]
async fn archiving_a_stored_task_is_refused_until_manual_archival_exists() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    helpers::make_agentic(&pool, board.inside_task).await;

    let archived = run(
        &mcp(&pool),
        TasksOperation::Archive {
            id: board.inside_task.into(),
        },
    )
    .await;

    assert_eq!(refused(&archived), "not_permitted");
    let message = body(&archived)["message"].as_str().unwrap_or("");
    assert!(message.contains("not supported yet"), "{message}");
    let archival: String = sqlx::query_scalar("SELECT archival FROM tasks WHERE id = ?")
        .bind(board.inside_task)
        .fetch_one(&pool)
        .await
        .expect("read the archival");
    assert_eq!(archival, "live", "nothing was written");
}

#[tokio::test]
async fn an_agents_write_never_lands_in_the_users_open_gesture() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let mcp = mcp(&pool);

    undo_commands::open_gesture(app.state())
        .await
        .expect("open gesture");
    let users = task(&app, "project", board.inside, "The user's").await;
    let agents = succeeded(&run(&mcp, create("project", board.inside, "The agent's")).await)["id"]
        .as_i64()
        .expect("a stored row");
    undo_commands::close_gesture(helpers::window(&app), app.state(), app.state())
        .await
        .expect("close gesture");
    undo_commands::undo(helpers::window(&app), app.state(), app.state())
        .await
        .expect("undo");

    let left: Vec<i64> = sqlx::query_scalar("SELECT id FROM tasks WHERE id IN (?, ?)")
        .bind(users)
        .bind(agents)
        .fetch_all(&pool)
        .await
        .expect("read the tasks");
    assert_eq!(
        left,
        vec![agents],
        "undo takes the user's write and leaves the agent's"
    );
}

#[tokio::test]
async fn a_short_id_a_longer_prefix_and_the_full_id_name_the_same_task() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    helpers::make_agentic(&pool, board.inside_task).await;
    let mcp = mcp(&pool);
    let short = short_id(&mcp, "tasks", board.inside_task).await;
    let full = uuid_v5(&NODE_NAMESPACE, &format!("task:{}", board.inside_task));
    assert!(
        full.starts_with(&short) && short.len() >= 3,
        "{short} of {full}"
    );

    for (index, id) in [short.clone(), full[..10].to_string(), full.clone()]
        .into_iter()
        .enumerate()
    {
        let got = mcp
            .tasks(Parameters(TasksOperation::Get {
                id: NodeIdParam::Short(id.clone()),
            }))
            .await
            .expect("the tasks tool returned no result");
        assert_eq!(succeeded(&got)["task"]["id"], board.inside_task, "{id}");
        let renamed = run(
            &mcp,
            retitle(NodeIdParam::Short(id), &format!("Renamed {index}")),
        )
        .await;
        succeeded(&renamed);
    }
    assert_eq!(title_of(&pool, board.inside_task).await, "Renamed 2");

    let linked = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: NodeIdParam::Short(short),
            beads_id: Some("Arlesh-rz0".into()),
        }))
        .await
        .expect("the beads tool returned no result");
    succeeded(&linked);
}

#[tokio::test]
async fn a_short_id_naming_nothing_visible_or_the_wrong_kind_is_refused() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let mcp = mcp(&pool);
    let hidden = uuid_v5(&NODE_NAMESPACE, &format!("task:{}", board.outside_task));
    let project = short_id(&mcp, "domains", board.inside).await;

    let unseen = run(&mcp, retitle(NodeIdParam::Short(hidden), "Found you")).await;
    assert_eq!(
        refused(&unseen),
        "not_permitted",
        "a hidden node is no node"
    );
    let nonsense = run(&mcp, retitle(NodeIdParam::Short("zz-top".into()), "Hm")).await;
    assert_eq!(refused(&nonsense), "not_permitted");
    let wrong_kind = run(&mcp, retitle(NodeIdParam::Short(project), "Hm")).await;
    assert_eq!(refused(&wrong_kind), "invalid_request");
}

/// Two task row ids whose full ids share their first three hex digits — and no other node the MCP
/// can see does — creating Tasks under `board.inside` until two do.
async fn colliding_tasks(app: &App<MockRuntime>, board: &Board) -> (i64, i64, String) {
    let prefix_of = |name: String| uuid_v5(&NODE_NAMESPACE, &name)[..3].to_string();
    let taken = [
        prefix_of(format!("domain:{}", board.inside)),
        prefix_of(format!("task:{}", board.inside_task)),
    ];
    let mut seen: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for index in 0..400 {
        let id = task(app, "project", board.inside, &format!("Task {index}")).await;
        let prefix = prefix_of(format!("task:{id}"));
        // An all-digit prefix may also be some visible row's id, which would add a third match.
        if taken.contains(&prefix) || prefix.bytes().all(|byte| byte.is_ascii_digit()) {
            continue;
        }
        if let Some(&first) = seen.get(&prefix) {
            return (first, id, prefix);
        }
        seen.insert(prefix, id);
    }
    panic!("no two of 400 tasks share three digits");
}

#[tokio::test]
async fn a_prefix_several_visible_nodes_share_is_refused_listing_them() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let (first, second, prefix) = colliding_tasks(&app, &board).await;
    let mcp = mcp(&pool);

    let got = mcp
        .tasks(Parameters(TasksOperation::Get {
            id: NodeIdParam::Short(prefix.clone()),
        }))
        .await
        .expect("the tasks tool returned no result");

    assert_eq!(refused(&got), "ambiguous_id");
    let candidates = body(&got)["details"]["candidates"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for id in [first, second] {
        let candidate = candidates
            .iter()
            .find(|candidate| candidate["node_id"] == id)
            .unwrap_or_else(|| panic!("task {id} is listed: {candidates:?}"));
        assert_eq!(candidate["kind"], "task");
        assert_eq!(
            candidate["id"],
            uuid_v5(&NODE_NAMESPACE, &format!("task:{id}"))
        );
        let short = candidate["short_id"].as_str().unwrap_or("");
        assert!(short.len() > 3 && short.starts_with(&prefix), "{short}");
        assert_eq!(candidate["path"], "Opened");
        assert!(candidate["title"]
            .as_str()
            .is_some_and(|title| title.starts_with("Task ")));
    }

    // A candidate the MCP cannot see is neither listed nor counted.
    set_column(
        &pool,
        "UPDATE tasks SET is_private = 1 WHERE id = ?",
        second,
    )
    .await;
    let got = mcp
        .tasks(Parameters(TasksOperation::Get {
            id: NodeIdParam::Short(prefix),
        }))
        .await
        .expect("the tasks tool returned no result");
    assert_eq!(succeeded(&got)["task"]["id"], first);
}

async fn agentic_snapshot(
    mcp: &ArleshMcp,
    max_priority: Option<AgenticPriority>,
) -> serde_json::Map<String, serde_json::Value> {
    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: None,
            sections: None,
            cursor: None,
            filter: None,
            agentic: Some(params::AgenticQuery { max_priority }),
        }))
        .await
        .expect("the snapshot tool returned no result");
    succeeded(&result).as_object().cloned().unwrap_or_default()
}

fn rows(
    payload: &serde_json::Map<String, serde_json::Value>,
    section: &str,
) -> Vec<serde_json::Value> {
    payload
        .get(section)
        .and_then(|items| items.as_array())
        .cloned()
        .unwrap_or_default()
}

#[tokio::test]
async fn the_snapshot_answers_which_tasks_read_as_agentic_most_urgent_first() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let flagged = task(&app, "project", board.inside, "Flagged").await;
    helpers::make_agentic(&pool, flagged).await;
    let inheriting = task(&app, "task", flagged, "Inherits it").await;
    let marked = task(&app, "task", flagged, "Opted out").await;
    not_agentic(&pool, marked).await;
    let mcp = mcp(&pool);
    for (id, priority) in [
        (flagged, AgenticPriority::B),
        (inheriting, AgenticPriority::Mw),
    ] {
        let briefed = run(
            &mcp,
            edit(
                id,
                None,
                Some(params::BriefParam {
                    priority: Some(Some(priority)),
                    ..Default::default()
                }),
                None,
            ),
        )
        .await;
        succeeded(&briefed);
    }

    let payload = agentic_snapshot(&mcp, None).await;

    let tasks = rows(&payload, "tasks");
    let ids: Vec<i64> = tasks
        .iter()
        .filter_map(|task| task["id"].as_i64())
        .collect();
    assert_eq!(
        ids,
        vec![inheriting, flagged],
        "stored and inherited alike, MW before B; neither the plain Task nor the opted-out one"
    );
    assert!(tasks.iter().all(|task| task["reads_agentic"] == true));
    assert_eq!(
        tasks[0]["agentic_brief"]["priority"], "MW",
        "the brief comes along"
    );
    let domains: Vec<i64> = rows(&payload, "domains")
        .iter()
        .filter_map(|domain| domain["id"].as_i64())
        .collect();
    assert_eq!(
        domains,
        vec![board.inside],
        "the project they hang from, for context"
    );
    assert!(rows(&payload, "flows").is_empty());

    let urgent = agentic_snapshot(&mcp, Some(AgenticPriority::A)).await;
    let tasks = rows(&urgent, "tasks");
    let by_id = |id: i64| tasks.iter().find(|task| task["id"] == id).cloned();
    assert_eq!(
        by_id(inheriting).map(|task| task["reads_agentic"].clone()),
        Some(serde_json::json!(true))
    );
    assert_eq!(
        by_id(flagged).map(|task| task["reads_agentic"].clone()),
        Some(serde_json::json!(false)),
        "a B above an MW match stays as context, marked so"
    );
}

#[tokio::test]
async fn every_node_carries_a_short_id_and_the_agentic_query_keeps_a_matchs_waits_and_notes() {
    use arlesh_lib::commands::{commitments as commitment_commands, infos as info_commands};
    use arlesh_lib::infos::model::CreateInfoRequest;
    use arlesh_lib::scopes::model::{Scope, ScopeKind};
    use arlesh_lib::tasks::model::{CreateCommitmentRequest, TimeScope};

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let goal = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Ship it".into(),
            parent_type: "project".into(),
            parent_id: board.inside.into(),
            ..Default::default()
        },
    )
    .await
    .expect("create goal")
    .id
    .sid();
    let flagged = task(&app, "goal", goal, "Flagged").await;
    helpers::make_agentic(&pool, flagged).await;
    let day = Scope::containing(
        ScopeKind::Day,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).expect("a date"),
    )
    .expect("a day");
    commitment_commands::create_commitment(
        app.state(),
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: board.inside.into(),
            time_scope: Some(TimeScope {
                start_id: day.id,
                end_id: day.id,
                duration: None,
            }),
            ..Default::default()
        },
    )
    .await
    .expect("create commitment");
    info_commands::create_info(
        app.state(),
        CreateInfoRequest {
            body: "The config lives in /etc".into(),
            details: None,
            parent_type: "task".into(),
            parent_id: flagged.into(),
            position: 0,
        },
    )
    .await
    .expect("create info");
    let mcp = mcp(&pool);
    let asked = mcp
        .waits(Parameters(params::WaitsOperation::Ask {
            task_id: NodeIdParam::Short(short_id(&mcp, "tasks", flagged).await),
            title: "Which config?".into(),
            note: None,
        }))
        .await
        .expect("the waits tool returned no result");
    succeeded(&asked);

    for section in [
        "domains",
        "goals",
        "tasks",
        "commitments",
        "expectations",
        "infos",
    ] {
        let named = snapshot(&mcp, section).await;
        assert!(!named.is_empty(), "the board has {section}");
        assert!(
            named.iter().all(|row| row["short_id"].is_string()),
            "every row of {section} carries a short id"
        );
    }

    let payload = agentic_snapshot(&mcp, None).await;
    let count = |section: &str| rows(&payload, section).len();
    assert_eq!(count("tasks"), 1, "only the flagged Task matches");
    assert_eq!(count("goals"), 1, "the goal it hangs from, for context");
    assert_eq!(count("expectations"), 1, "its wait comes along");
    assert_eq!(count("infos"), 1, "and its note");
    assert_eq!(count("commitments"), 0, "a commitment beside it does not");
}

mod agent_waits {
    //! Question waits and waits on something else: who releases them, and with what.

    use super::*;
    use arlesh_lib::commands::expectations as expectation_commands;
    use arlesh_lib::tasks::model::{ExpectationStatus, UpdateExpectationRequest};

    async fn waits(mcp: &ArleshMcp, operation: params::WaitsOperation) -> CallToolResult {
        mcp.waits(Parameters(operation))
            .await
            .expect("the waits tool returned no result")
    }

    /// An agentic Task inside a root, and a wait raised on it over the MCP.
    async fn raised(question: bool) -> (sqlx::SqlitePool, App<MockRuntime>, ArleshMcp, i64) {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        helpers::make_agentic(&pool, board.inside_task).await;
        let mcp = mcp(&pool);
        let wait = waits(
            &mcp,
            params::WaitsOperation::Raise {
                task_id: board.inside_task.into(),
                title: if question {
                    "Which colour?"
                } else {
                    "CI on #86"
                }
                .into(),
                note: None,
                question,
            },
        )
        .await;
        let id = succeeded(&wait)["id"].as_i64().expect("a stored wait");
        assert_eq!(succeeded(&wait)["question"], question);
        (pool, app, mcp, id)
    }

    fn release(id: i64, answer: Option<&str>) -> params::WaitsOperation {
        params::WaitsOperation::Release {
            id: id.into(),
            answer: answer.map(str::to_string),
        }
    }

    async fn get(mcp: &ArleshMcp, id: i64) -> serde_json::Value {
        succeeded(&waits(mcp, params::WaitsOperation::Get { id: id.into() }).await).clone()
    }

    #[tokio::test]
    async fn an_agent_releases_a_wait_on_something_else_with_no_answer() {
        let (_pool, _app, mcp, id) = raised(false).await;

        let released = waits(&mcp, release(id, None)).await;

        assert_eq!(succeeded(&released)["status"], "released");
        assert_eq!(get(&mcp, id).await["status"], "released");
    }

    #[tokio::test]
    async fn an_agent_releases_a_question_only_with_the_answer_it_got() {
        let (_pool, _app, mcp, id) = raised(true).await;

        let bare = waits(&mcp, release(id, None)).await;
        assert_eq!(refused(&bare), "invalid_request");
        let blank = waits(&mcp, release(id, Some("  "))).await;
        assert_eq!(refused(&blank), "invalid_request");
        assert_eq!(
            get(&mcp, id).await["status"],
            "pending",
            "nothing was written"
        );

        succeeded(&waits(&mcp, release(id, Some("Blue, the user said"))).await);

        let polled = get(&mcp, id).await;
        assert_eq!(polled["status"], "released");
        assert_eq!(polled["question"], true);
        assert_eq!(polled["answer"], "Blue, the user said");
    }

    #[tokio::test]
    async fn the_user_releases_a_question_only_with_an_answer_and_the_agent_reads_it() {
        let (_pool, app, mcp, id) = raised(true).await;
        let release_as_user = |answer: Option<&str>| UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            answer: answer.map(|answer| Some(answer.to_string())),
            ..Default::default()
        };

        let refused_release =
            expectation_commands::update_expectation(app.state(), id.into(), release_as_user(None))
                .await
                .expect_err("a question is not released without its answer");
        assert_eq!(
            serde_json::to_value(refused_release).expect("serialise")["kind"],
            "invalid_request"
        );

        expectation_commands::update_expectation(
            app.state(),
            id.into(),
            release_as_user(Some("Blue")),
        )
        .await
        .expect("released with its answer");

        let polled = get(&mcp, id).await;
        assert_eq!(polled["status"], "released");
        assert_eq!(polled["answer"], "Blue");
        let snapshot_row = snapshot(&mcp, "expectations")
            .await
            .into_iter()
            .find(|row| row["id"] == id)
            .expect("the wait is on the board");
        assert_eq!(snapshot_row["answer"], "Blue");
        assert_eq!(snapshot_row["question"], true);
    }

    #[tokio::test]
    async fn an_agent_cannot_release_a_wait_it_did_not_raise_or_outside_what_it_writes() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        let plain = expectation_commands::create_expectation(
            app.state(),
            arlesh_lib::tasks::model::CreateExpectationRequest {
                title: "Parts arrive".into(),
                parent_type: "task".into(),
                parent_id: board.inside_task.into(),
                ..Default::default()
            },
        )
        .await
        .expect("create wait")
        .id
        .sid();
        let mcp = mcp(&pool);

        assert_eq!(
            refused(&waits(&mcp, release(plain, None)).await),
            "not_permitted"
        );
        assert_eq!(
            get(&mcp, plain).await["agentic"],
            false,
            "but it can still see it"
        );
    }

    /// A done Asynchronous Agentic Task inside a root, and the wait its completion spawned — a
    /// derived row, made agentic in the app as any wait is edited.
    #[tokio::test]
    async fn an_agent_polls_and_releases_a_spawned_wait_made_agentic_like_a_stored_one() {
        use arlesh_lib::tasks::model::{AsyncTemplate, UpdateTaskRequest};

        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        helpers::make_agentic(&pool, board.inside_task).await;
        task_commands::update_task(
            app.state(),
            board.inside_task.into(),
            UpdateTaskRequest {
                asynchronous: Some(true),
                async_template: Some(Some(AsyncTemplate {
                    title: "CI on the branch".into(),
                    tag_ids: vec![],
                    time_scope: None,
                    check_every: None,
                })),
                status: Some(arlesh_lib::tasks::model::TaskStatus::Done),
                ..Default::default()
            },
            None,
        )
        .await
        .expect("complete the asynchronous task");
        let mcp = mcp(&pool);
        let spawned = snapshot(&mcp, "expectations")
            .await
            .into_iter()
            .find(|row| row["origin"]["kind"] == "spawned_wait")
            .expect("the spawned wait is an expectation row");
        let full_id = spawned["full_id"].as_str().expect("a full id").to_string();
        let wait_id = arlesh_lib::nodes::id::NodeId::Derived(
            arlesh_lib::nodes::id::DerivedId::from_existing(
                spawned["id"]
                    .as_str()
                    .expect("a derived wait's id is its UUID"),
            ),
        );

        // Not agentic: the agent sees it, and cannot release it.
        let bare = waits(
            &mcp,
            params::WaitsOperation::Release {
                id: NodeIdParam::Short(full_id.clone()),
                answer: None,
            },
        )
        .await;
        assert_eq!(refused(&bare), "not_permitted");

        expectation_commands::update_expectation(
            app.state(),
            wait_id,
            UpdateExpectationRequest {
                agentic: Some(true),
                question: Some(false),
                agentic_note: Some(Some("Green on the branch".into())),
                ..Default::default()
            },
        )
        .await
        .expect("the user makes the spawned wait agentic, as any wait");

        let polled = succeeded(
            &waits(
                &mcp,
                params::WaitsOperation::Get {
                    id: NodeIdParam::Short(full_id.clone()),
                },
            )
            .await,
        )
        .clone();
        assert_eq!(polled["agentic"], true);
        assert_eq!(polled["agentic_note"], "Green on the branch");
        assert_eq!(polled["status"], "pending");

        let released = waits(
            &mcp,
            params::WaitsOperation::Release {
                id: NodeIdParam::Short(full_id.clone()),
                answer: None,
            },
        )
        .await;
        assert_eq!(succeeded(&released)["status"], "released");
        let row = snapshot(&mcp, "expectations")
            .await
            .into_iter()
            .find(|row| row["full_id"] == full_id.as_str())
            .expect("still the same row");
        assert_eq!(row["status"], "released");
        assert_eq!(
            row["title"], "CI on the branch",
            "drawn from the template still"
        );
    }
}

mod agent_notes {
    //! Infos an agent hangs under the Agentic Task it is working — the full wording of a title it
    //! shortened, or any other note.

    use super::*;

    async fn infos(mcp: &ArleshMcp, operation: params::InfosOperation) -> CallToolResult {
        mcp.infos(Parameters(operation))
            .await
            .expect("the infos tool returned no result")
    }

    fn note(task_id: impl Into<NodeIdParam>, body: &str) -> params::InfosOperation {
        params::InfosOperation::Create {
            task_id: task_id.into(),
            body: body.into(),
            details: None,
        }
    }

    async fn info_count(pool: &sqlx::SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM infos")
            .fetch_one(pool)
            .await
            .expect("count the infos")
    }

    #[tokio::test]
    async fn an_agent_notes_a_shortened_titles_full_wording_under_its_agentic_task() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        helpers::make_agentic(&pool, board.inside_task).await;
        let mcp = mcp(&pool);
        let task_short_id = short_id(&mcp, "tasks", board.inside_task).await;

        let created = infos(
            &mcp,
            params::InfosOperation::Create {
                task_id: NodeIdParam::Short(task_short_id),
                body: "Visible work, in the words the user first gave it".into(),
                details: Some("And the rest of it".into()),
            },
        )
        .await;

        let created = succeeded(&created).clone();
        assert_eq!(
            created["body"],
            "Visible work, in the words the user first gave it"
        );
        assert_eq!(created["details"], "And the rest of it");
        assert_eq!(created["parent_type"], "task");
        assert_eq!(created["parent_id"], board.inside_task);
        let id = created["id"].as_i64().expect("a stored row");
        assert_eq!(
            created["full_id"],
            uuid_v5(&NODE_NAMESPACE, &format!("info:{id}"))
        );
        assert_eq!(
            created["short_id"].as_str(),
            Some(short_id(&mcp, "infos", id).await.as_str()),
            "the short id it is given is the one the snapshot then shows"
        );
        let source: String = sqlx::query_scalar(
            "SELECT source FROM undo_journal WHERE table_name = 'infos' ORDER BY seq DESC LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .expect("the info was journaled");
        assert_eq!(source, "mcp");
    }

    #[tokio::test]
    async fn a_note_is_refused_under_a_task_the_agent_cannot_write() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        let marked = task(&app, "project", board.inside, "The user's own").await;
        not_agentic(&pool, marked).await;
        let private = task(&app, "project", board.inside, "The user's secret").await;
        helpers::make_agentic(&pool, private).await;
        set_column(
            &pool,
            "UPDATE tasks SET is_private = 1 WHERE id = ?",
            private,
        )
        .await;
        helpers::make_agentic(&pool, board.outside_task).await;
        let mcp = mcp(&pool);

        let plain = infos(&mcp, note(board.inside_task, "A note")).await;
        assert_eq!(
            refused(&plain),
            "not_permitted",
            "a Task that is not Agentic"
        );
        let under_marked = infos(&mcp, note(marked, "A note")).await;
        assert_eq!(refused(&under_marked), "not_permitted");
        let under_private = infos(&mcp, note(private, "A note")).await;
        assert_eq!(refused(&under_private), "not_permitted");
        let outside = infos(&mcp, note(board.outside_task, "A note")).await;
        assert_eq!(
            refused(&outside),
            "not_permitted",
            "an Agentic Task outside the roots"
        );
        assert_eq!(info_count(&pool).await, 0, "nothing was written");
    }

    #[tokio::test]
    async fn a_blank_note_is_refused() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        helpers::make_agentic(&pool, board.inside_task).await;
        let mcp = mcp(&pool);

        let blank = infos(&mcp, note(board.inside_task, "  ")).await;

        assert_eq!(refused(&blank), "invalid_request");
        assert_eq!(info_count(&pool).await, 0, "nothing was written");
    }

    #[tokio::test]
    async fn an_agents_note_never_lands_on_the_users_undo_stack() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        helpers::make_agentic(&pool, board.inside_task).await;
        let mcp = mcp(&pool);

        undo_commands::open_gesture(app.state())
            .await
            .expect("open gesture");
        let users = task(&app, "project", board.inside, "The user's").await;
        let agents = succeeded(&infos(&mcp, note(board.inside_task, "The agent's")).await)["id"]
            .as_i64()
            .expect("a stored row");
        undo_commands::close_gesture(helpers::window(&app), app.state(), app.state())
            .await
            .expect("close gesture");
        undo_commands::undo(helpers::window(&app), app.state(), app.state())
            .await
            .expect("undo");

        let users_left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE id = ?")
            .bind(users)
            .fetch_one(&pool)
            .await
            .expect("read the tasks");
        assert_eq!(users_left, 0, "undo takes the user's write");
        let agents_left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM infos WHERE id = ?")
            .bind(agents)
            .fetch_one(&pool)
            .await
            .expect("read the infos");
        assert_eq!(agents_left, 1, "and leaves the agent's note");
    }
}

#[tokio::test]
async fn an_id_given_as_a_number_or_its_digits_names_the_row() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    helpers::make_agentic(&pool, board.inside_task).await;
    let mcp = mcp(&pool);
    let as_string = NodeIdParam::Short(board.inside_task.to_string());

    let as_number = run(
        &mcp,
        TasksOperation::Get {
            id: board.inside_task.into(),
        },
    )
    .await;
    assert_eq!(succeeded(&as_number)["task"]["id"], board.inside_task);

    let got = run(
        &mcp,
        TasksOperation::Get {
            id: as_string.clone(),
        },
    )
    .await;
    assert_eq!(succeeded(&got)["task"]["id"], board.inside_task);
    succeeded(&run(&mcp, retitle(as_string, "Renamed by string")).await);
    assert_eq!(
        title_of(&pool, board.inside_task).await,
        "Renamed by string"
    );

    let linked = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: NodeIdParam::Short(format!(" {} ", board.inside_task)),
            beads_id: Some("Arlesh-rz0".into()),
        }))
        .await
        .expect("the beads tool returned no result");
    succeeded(&linked);

    let raised = mcp
        .waits(Parameters(params::WaitsOperation::Raise {
            task_id: NodeIdParam::Short(board.inside_task.to_string()),
            title: "CI on #86".into(),
            note: None,
            question: false,
        }))
        .await
        .expect("the waits tool returned no result");
    let wait = succeeded(&raised)["id"].as_i64().expect("a stored wait");
    let by_string = || NodeIdParam::Short(wait.to_string());
    let polled = mcp
        .waits(Parameters(params::WaitsOperation::Get { id: by_string() }))
        .await
        .expect("the waits tool returned no result");
    assert_eq!(succeeded(&polled)["id"], wait);
    let released = mcp
        .waits(Parameters(params::WaitsOperation::Release {
            id: by_string(),
            answer: None,
        }))
        .await
        .expect("the waits tool returned no result");
    assert_eq!(succeeded(&released)["status"], "released");
}

#[tokio::test]
async fn a_domain_table_parent_is_named_by_its_true_subtype_whatever_it_was_called() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    let mcp = mcp(&pool);

    // Any of the four spellings names the same table, so each is accepted — and the row is
    // written, and reported, under its parent's true subtype.
    let created = run(&mcp, create("domain", board.inside, "Called a domain")).await;
    assert_eq!(succeeded(&created)["parent_type"], "project");
    let id = succeeded(&created)["id"].as_i64().expect("a stored row");
    let stored: String = sqlx::query_scalar("SELECT parent_type FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .expect("read the parent type");
    assert_eq!(stored, "project");

    // A row stored under a wrong spelling is still reported by the true one.
    sqlx::query("UPDATE tasks SET parent_type = 'domain' WHERE id = ?")
        .bind(board.inside_task)
        .execute(&pool)
        .await
        .expect("misspell the fixture's parent");
    let row = snapshot(&mcp, "tasks")
        .await
        .into_iter()
        .find(|row| row["id"] == board.inside_task)
        .expect("the task is on the board");
    assert_eq!(row["parent_type"], "project");
    assert!(row["full_id"].is_string() && row["short_id"].is_string());
}

#[tokio::test]
async fn a_nodes_short_id_is_the_same_in_every_view() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let board = board(&app).await;
    helpers::make_agentic(&pool, board.inside_task).await;
    for index in 0..40 {
        task(&app, "project", board.inside, &format!("Filler {index}")).await;
    }
    let mcp = mcp(&pool);

    let whole = short_id(&mcp, "tasks", board.inside_task).await;
    let agentic = rows(&agentic_snapshot(&mcp, None).await, "tasks")
        .into_iter()
        .find(|row| row["id"] == board.inside_task)
        .and_then(|row| row["short_id"].as_str().map(str::to_string))
        .expect("the agentic task is in the agentic query");

    assert_eq!(
        agentic, whole,
        "worked out over everything visible, not over what one query returned"
    );
}

mod task_fields {
    //! The rest of an Agentic Task through `create` and `update`: its windows, its lapse and
    //! Asynchronous flag, its prerequisites, tags and block reasons — each set and cleared, each
    //! refused where the app or the roots refuse it, and a refused update writing none of itself.

    use super::*;
    use serde_json::json;

    fn week(date: &str) -> serde_json::Value {
        let key = json!({ "kind": "week", "date": date });
        json!({ "start_id": key, "end_id": key })
    }

    fn day(date: &str) -> serde_json::Value {
        let key = json!({ "kind": "day", "date": date });
        json!({ "start_id": key, "end_id": key })
    }

    async fn tag(app: &App<MockRuntime>, parent: i64, title: &str) -> i64 {
        domain_commands::create_domain(
            app.state(),
            CreateDomainRequest {
                title: title.into(),
                description: None,
                subtype: DomainSubtype::Tag,
                parent_id: Some(parent),
                status: None,
                knowledge_base_directory: None,
            },
        )
        .await
        .expect("create tag")
        .id
    }

    async fn prerequisites(pool: &sqlx::SqlitePool, id: i64) -> Vec<i64> {
        sqlx::query_scalar(
            "SELECT dependency_id FROM task_dependencies \
             WHERE task_id = ? AND dependency_type = 'task' ORDER BY dependency_id",
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .expect("read the dependencies")
    }

    async fn block_reasons(mcp: &ArleshMcp, id: i64) -> Vec<String> {
        let got = run(mcp, TasksOperation::Get { id: id.into() }).await;
        succeeded(&got)["block_reasons"]
            .as_array()
            .expect("block reasons")
            .iter()
            .filter_map(|reason| reason.as_str().map(str::to_string))
            .collect()
    }

    async fn journal_end(pool: &sqlx::SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM undo_journal")
            .fetch_one(pool)
            .await
            .expect("read the journal")
    }

    #[tokio::test]
    async fn a_task_is_created_with_every_field_journaled_as_the_agents() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        let label = tag(&app, board.inside, "backend").await;
        let mcp = mcp(&pool);
        let before = journal_end(&pool).await;

        let created = run(
            &mcp,
            operation(json!({
                "operation": "create",
                "parent_type": "project",
                "parent_id": board.inside.to_string(),
                "title": "Ship the parser",
                "time_scope": week("2026-09-20"),
                "plan": day("2026-09-22"),
                "on_scope_exit": "archive",
                "asynchronous": true,
                "dependencies": [board.inside_task.to_string()],
                "tags": [label.to_string()],
                "block_reasons": ["Waiting on review"],
            })),
        )
        .await;

        let created = succeeded(&created).clone();
        let id = created["id"].as_i64().expect("a stored row");
        assert_eq!(created["agentic"], true);
        assert_eq!(created["time_scope"]["start_id"]["kind"], "week");
        assert_eq!(created["plan"]["start_id"]["date"], "2026-09-22");
        assert_eq!(created["on_scope_exit"], "archive");
        assert_eq!(created["asynchronous"], true);
        assert_eq!(created["tag_ids"], json!([label]));
        assert_eq!(prerequisites(&pool, id).await, vec![board.inside_task]);
        assert!(block_reasons(&mcp, id)
            .await
            .contains(&"Waiting on review".to_string()));

        let users: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM undo_journal WHERE seq > ? AND source <> 'mcp'",
        )
        .bind(before)
        .fetch_one(&pool)
        .await
        .expect("read the journal");
        assert_eq!(users, 0, "none of it reaches the user's Undo Stack");
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT table_name FROM undo_journal WHERE seq > ? ORDER BY table_name",
        )
        .bind(before)
        .fetch_all(&pool)
        .await
        .expect("read the journal");
        for table in [
            "tasks",
            "task_dependencies",
            "tags_on_tasks",
            "block_reasons",
        ] {
            assert!(
                tables.iter().any(|name| name == table),
                "{table} in {tables:?}"
            );
        }
    }

    #[tokio::test]
    async fn each_field_is_set_and_then_cleared_on_an_agentic_task() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        helpers::make_agentic(&pool, board.inside_task).await;
        let first = task(&app, "project", board.inside, "Lay the groundwork").await;
        let label = tag(&app, board.inside, "backend").await;
        let mcp = mcp(&pool);
        let id = board.inside_task;

        let set = run(
            &mcp,
            operation(json!({
                "operation": "update",
                "id": id.to_string(),
                "time_scope": week("2026-09-20"),
                "plan": day("2026-09-22"),
                "on_scope_exit": "archive",
                "asynchronous": true,
                "add_dependencies": [first.to_string()],
                "add_tags": [label.to_string()],
                "block_reasons": ["Waiting on review", "Needs a design"],
            })),
        )
        .await;
        let set = succeeded(&set).clone();
        assert_eq!(set["time_scope"]["start_id"]["date"], "2026-09-20");
        assert_eq!(set["plan"]["start_id"]["date"], "2026-09-22");
        assert_eq!(set["on_scope_exit"], "archive");
        assert_eq!(set["asynchronous"], true);
        assert_eq!(set["tag_ids"], json!([label]));
        assert_eq!(prerequisites(&pool, id).await, vec![first]);
        let reasons = block_reasons(&mcp, id).await;
        assert_eq!(&reasons[..2], ["Waiting on review", "Needs a design"]);

        let cleared = run(
            &mcp,
            operation(json!({
                "operation": "update",
                "id": id.to_string(),
                "time_scope": null,
                "plan": null,
                "asynchronous": false,
                "remove_dependencies": [first.to_string()],
                "remove_tags": [label.to_string()],
                "block_reasons": null,
            })),
        )
        .await;
        let cleared = succeeded(&cleared).clone();
        assert!(cleared["time_scope"].is_null());
        assert!(cleared["plan"].is_null());
        assert_eq!(cleared["asynchronous"], false);
        assert_eq!(cleared["tag_ids"], json!([]));
        assert!(prerequisites(&pool, id).await.is_empty());
        assert!(block_reasons(&mcp, id).await.is_empty());
    }

    #[tokio::test]
    async fn a_task_that_is_not_agentic_takes_none_of_it() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        let first = task(&app, "project", board.inside, "Lay the groundwork").await;
        let mcp = mcp(&pool);

        let refused_write = run(
            &mcp,
            operation(json!({
                "operation": "update",
                "id": board.inside_task.to_string(),
                "add_dependencies": [first.to_string()],
                "block_reasons": ["Mine now"],
            })),
        )
        .await;

        assert_eq!(refused(&refused_write), "not_permitted");
        assert!(prerequisites(&pool, board.inside_task).await.is_empty());
    }

    #[tokio::test]
    async fn a_prerequisite_or_tag_the_mcp_cannot_see_is_not_permitted() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        helpers::make_agentic(&pool, board.inside_task).await;
        let private = task(&app, "project", board.inside, "The user's secret").await;
        set_column(
            &pool,
            "UPDATE tasks SET is_private = 1 WHERE id = ?",
            private,
        )
        .await;
        let hidden_tag = tag(&app, board.outside, "hidden").await;
        let mcp = mcp(&pool);
        let add = |field: &str, target: i64| {
            operation(json!({
                "operation": "update",
                "id": board.inside_task.to_string(),
                "title": "Should not land",
                field: [target.to_string()],
            }))
        };

        for (field, target) in [
            ("add_dependencies", board.outside_task),
            ("add_dependencies", private),
            ("add_tags", hidden_tag),
        ] {
            let result = run(&mcp, add(field, target)).await;
            assert_eq!(refused(&result), "not_permitted", "{field} {target}");
        }
        let outside = run(
            &mcp,
            operation(json!({
                "operation": "create",
                "parent_type": "project",
                "parent_id": board.inside.to_string(),
                "title": "Should not land",
                "dependencies": [board.outside_task.to_string()],
            })),
        )
        .await;
        assert_eq!(refused(&outside), "not_permitted");

        let not_a_tag = run(&mcp, add("add_tags", board.inside)).await;
        assert_eq!(
            refused(&not_a_tag),
            "invalid_request",
            "a project is no tag"
        );
        assert_eq!(title_of(&pool, board.inside_task).await, "Visible work");
    }

    #[tokio::test]
    async fn a_dependency_cycle_is_refused_and_the_rest_of_the_update_with_it() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        helpers::make_agentic(&pool, board.inside_task).await;
        let label = tag(&app, board.inside, "backend").await;
        let mcp = mcp(&pool);
        let after = run(
            &mcp,
            operation(json!({
                "operation": "create",
                "parent_type": "project",
                "parent_id": board.inside.to_string(),
                "title": "Comes after",
                "dependencies": [board.inside_task.to_string()],
            })),
        )
        .await;
        let after = succeeded(&after)["id"].as_i64().expect("a stored row");

        let cycle = run(
            &mcp,
            operation(json!({
                "operation": "update",
                "id": board.inside_task.to_string(),
                "title": "Should not land",
                "add_tags": [label.to_string()],
                "block_reasons": ["Should not land"],
                "add_dependencies": [after.to_string()],
            })),
        )
        .await;
        assert_eq!(refused(&cycle), "invalid_request");
        let message = body(&cycle)["message"].as_str().unwrap_or("");
        assert!(message.contains("cycle"), "{message}");

        let own = run(
            &mcp,
            operation(json!({
                "operation": "update",
                "id": board.inside_task.to_string(),
                "add_dependencies": [board.inside_task.to_string()],
            })),
        )
        .await;
        assert_eq!(
            refused(&own),
            "invalid_request",
            "nothing comes after itself"
        );

        assert_eq!(title_of(&pool, board.inside_task).await, "Visible work");
        assert!(prerequisites(&pool, board.inside_task).await.is_empty());
        assert!(block_reasons(&mcp, board.inside_task).await.is_empty());
        let tagged: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM tags_on_tasks WHERE task_id = ?")
                .bind(board.inside_task)
                .fetch_one(&pool)
                .await
                .expect("read the tags");
        assert_eq!(
            tagged, 0,
            "all or nothing: the row and its relations roll back together"
        );
    }

    #[tokio::test]
    async fn a_plan_outside_the_time_scope_is_refused_with_the_apps_reason() {
        let pool = helpers::test_pool().await;
        let app = helpers::command_host(&pool);
        let board = board(&app).await;
        helpers::make_agentic(&pool, board.inside_task).await;
        let mcp = mcp(&pool);

        let outside = run(
            &mcp,
            operation(json!({
                "operation": "update",
                "id": board.inside_task.to_string(),
                "title": "Should not land",
                "time_scope": week("2026-09-20"),
                "plan": day("2026-10-05"),
            })),
        )
        .await;

        assert_eq!(refused(&outside), "containment_violated");
        assert_eq!(title_of(&pool, board.inside_task).await, "Visible work");
        let created = run(
            &mcp,
            operation(json!({
                "operation": "create",
                "parent_type": "project",
                "parent_id": board.inside.to_string(),
                "title": "Should not land",
                "time_scope": week("2026-09-20"),
                "plan": day("2026-10-05"),
            })),
        )
        .await;
        assert_eq!(refused(&created), "containment_violated");
    }
}
