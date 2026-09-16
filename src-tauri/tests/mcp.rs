//! Tool-level tests for the MCP server.
//!
//! The tools are a second adapter over the same session layer `commands/` uses, so the property
//! worth proving is **equivalence**: a tool must return what the command it stands in for returns,
//! on the wire. Comparing `serde_json::Value` rather than the models themselves is deliberate —
//! most of these types derive no `PartialEq`, and the wire form is what an agent actually receives.
//!
//! The pool has **one** connection (see [`helpers::test_pool`]), so every assertion reads it only
//! after the tool's session has closed.

mod helpers;

use arlesh_lib::mcp::{params, ArleshMcp};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use tauri::Manager;

/// The structured payload of a successful tool call.
///
/// Fails the test on an error result rather than returning it: every caller here asserts on a
/// payload, and an `is_error` result carrying a `WireError` is more useful named than unwrapped.
fn payload(result: &CallToolResult) -> &serde_json::Value {
    assert_ne!(
        result.is_error,
        Some(true),
        "tool returned an error result: {:?}",
        result.structured_content
    );
    result
        .structured_content
        .as_ref()
        .expect("tool result carried no structured content")
}

/// The `WireError` payload of a failed tool call.
fn error_payload(result: &CallToolResult) -> &serde_json::Value {
    assert_eq!(
        result.is_error,
        Some(true),
        "expected an error result, got: {:?}",
        result.structured_content
    );
    result
        .structured_content
        .as_ref()
        .expect("error result carried no structured content")
}

#[tokio::test]
async fn scopes_get_returns_what_the_command_returns() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));

    // A scope has to exist before it can be fetched, and `get_or_create_scope` is the only way in.
    let created = arlesh_lib::commands::scopes::get_or_create_scope(
        app.state(),
        arlesh_lib::scopes::model::ScopeKind::Week,
        "2026-02-02".into(),
    )
    .await
    .unwrap();

    let result = mcp
        .scopes(Parameters(params::ScopesOperation::Get { id: created.id }))
        .await
        .unwrap();

    let expected = arlesh_lib::commands::scopes::get_scope(app.state(), created.id)
        .await
        .unwrap();
    assert_eq!(
        payload(&result),
        &serde_json::to_value(&expected).unwrap(),
        "scopes.get"
    );
}

#[tokio::test]
async fn scopes_get_on_a_missing_id_reports_not_found() {
    let pool = helpers::test_pool().await;
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));

    let result = mcp
        .scopes(Parameters(params::ScopesOperation::Get { id: 99_999 }))
        .await
        .unwrap();

    // The point of routing through `WireError` rather than stringifying: the agent gets the same
    // machine-readable discriminant the frontend does, not prose it has to pattern-match on.
    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("not_found"),
    );
}

#[tokio::test]
async fn scopes_resolve_many_resolves_each_id_in_order() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));

    let mut ids = Vec::new();
    for date in ["2026-02-02", "2026-02-09", "2026-02-16"] {
        let scope = arlesh_lib::commands::scopes::get_or_create_scope(
            app.state(),
            arlesh_lib::scopes::model::ScopeKind::Week,
            date.into(),
        )
        .await
        .unwrap();
        ids.push(scope.id);
    }

    let result = mcp
        .scopes(Parameters(params::ScopesOperation::ResolveMany { ids: ids.clone() }))
        .await
        .unwrap();

    // `resolve_many` exists so an agent holding a snapshot does not pay a round trip per scope id.
    // Order matters: the caller pairs results back to the ids it sent positionally.
    let mut expected = Vec::new();
    for id in &ids {
        expected.push(
            arlesh_lib::commands::scopes::resolve_scope(app.state(), *id)
                .await
                .unwrap(),
        );
    }
    assert_eq!(
        payload(&result),
        &serde_json::to_value(&expected).unwrap(),
        "scopes.resolve_many"
    );
}

#[tokio::test]
async fn kb_lists_match_their_commands() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));

    arlesh_lib::commands::knowledge_base::create_person(
        app.state(),
        arlesh_lib::knowledge_base::model::CreatePersonRequest {
            name: "Ada".into(),
            aliases: None,
            linked_note: None,
        },
    )
    .await
    .unwrap();

    let result = mcp
        .kb(Parameters(params::KbOperation::ListPeople))
        .await
        .unwrap();

    let expected = arlesh_lib::commands::knowledge_base::list_people(app.state())
        .await
        .unwrap();
    assert_eq!(
        payload(&result),
        &serde_json::to_value(&expected).unwrap(),
        "kb.list_people"
    );
}

/// Seeds a project, a goal and a task, returning the task id.
async fn seed(app: &tauri::App<tauri::test::MockRuntime>) -> i64 {
    use arlesh_lib::commands::{domains as domain_commands, tasks as task_commands};
    use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype};
    use arlesh_lib::tasks::model::{CreateGoalRequest, CreateTaskRequest};

    domain_commands::create_domain(
        app.state(),
        CreateDomainRequest {
            title: "Ops".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(1),
            status: None,
            knowledge_base_directory: None,
        },
    )
    .await
    .unwrap();

    let goal = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Ship".into(),
            parent_type: "domain".into(),
            parent_id: 1,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Write".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
}

/// The reference instant the snapshot tests load at.
fn now() -> chrono::NaiveDateTime {
    chrono::NaiveDate::from_ymd_opt(2026, 2, 4)
        .unwrap()
        .and_hms_opt(9, 0, 0)
        .unwrap()
}

#[tokio::test]
async fn every_tool_is_registered() {
    let pool = helpers::test_pool().await;
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));

    // `ArleshMcp::new` sums five routers. Drop one and nothing fails to compile — the tool simply
    // stops being served, which an agent would discover and this test does not let pass silently.
    assert_eq!(
        mcp.tool_names(),
        vec![
            "arlesh_flows",
            "arlesh_kb",
            "arlesh_scopes",
            "arlesh_snapshot",
            "arlesh_tasks",
        ]
    );
}

#[tokio::test]
async fn snapshot_returns_what_the_mindmap_command_returns() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));
    seed(&app).await;

    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load { now: now() }))
        .await
        .unwrap();

    let expected = arlesh_lib::commands::mindmap::load_mindmap(app.state(), now())
        .await
        .unwrap();
    assert_eq!(
        payload(&result),
        &serde_json::to_value(&expected).unwrap(),
        "snapshot.load"
    );
}

#[tokio::test]
async fn snapshot_commits_rather_than_rolling_back() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));
    seed(&app).await;

    // Deriving habit iterations mints the scope rows their windows land on. Replacing the
    // `db.commit()` in the tool with `Ok(())` still compiles and still returns a correct-looking
    // payload, because sqlx rolls a dropped transaction back silently. Only reading the rows off
    // the pool after the tool's session has closed tells the difference.
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scopes")
        .fetch_one(&pool)
        .await
        .unwrap();

    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load { now: now() }))
        .await
        .unwrap();
    assert_ne!(result.is_error, Some(true));

    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scopes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        after >= before,
        "snapshot lost scope rows: {before} before, {after} after"
    );
}

#[tokio::test]
async fn tasks_get_returns_what_the_command_returns() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));
    let task_id = seed(&app).await;

    let result = mcp
        .tasks(Parameters(params::TasksOperation::Get { id: task_id }))
        .await
        .unwrap();

    let expected = arlesh_lib::commands::tasks::get_task(app.state(), task_id)
        .await
        .unwrap();
    assert_eq!(
        payload(&result),
        &serde_json::to_value(&expected).unwrap(),
        "tasks.get"
    );
}

#[tokio::test]
async fn tasks_get_on_a_missing_id_reports_not_found() {
    let pool = helpers::test_pool().await;
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));

    let result = mcp
        .tasks(Parameters(params::TasksOperation::Get { id: 99_999 }))
        .await
        .unwrap();

    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("not_found"),
    );
}

#[tokio::test]
async fn tasks_containment_conflicts_matches_the_command() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));
    let task_id = seed(&app).await;

    let scope = arlesh_lib::commands::scopes::get_or_create_scope(
        app.state(),
        arlesh_lib::scopes::model::ScopeKind::Week,
        "2026-02-02".into(),
    )
    .await
    .unwrap();

    let result = mcp
        .tasks(Parameters(params::TasksOperation::ContainmentConflicts {
            node: params::NodeRef {
                node_type: "task".into(),
                node_id: task_id,
            },
            time_scope: params::TimeScope {
                start_id: scope.id,
                end_id: scope.id,
                duration: None,
            },
        }))
        .await
        .unwrap();

    let expected = arlesh_lib::commands::tasks::scope_containment_conflicts(
        app.state(),
        "task".into(),
        task_id,
        arlesh_lib::tasks::model::TimeScope {
            start_id: scope.id,
            end_id: scope.id,
            duration: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        payload(&result),
        &serde_json::to_value(&expected).unwrap(),
        "tasks.containment_conflicts"
    );
}

#[tokio::test]
async fn kb_get_person_and_remaining_lists_match_their_commands() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));

    let person = arlesh_lib::commands::knowledge_base::create_person(
        app.state(),
        arlesh_lib::knowledge_base::model::CreatePersonRequest {
            name: "Grace".into(),
            aliases: None,
            linked_note: None,
        },
    )
    .await
    .unwrap();

    let got = mcp
        .kb(Parameters(params::KbOperation::GetPerson { id: person.id }))
        .await
        .unwrap();
    let expected_person = arlesh_lib::commands::knowledge_base::get_person(app.state(), person.id)
        .await
        .unwrap();
    assert_eq!(
        payload(&got),
        &serde_json::to_value(&expected_person).unwrap(),
        "kb.get_person"
    );

    let events = mcp
        .kb(Parameters(params::KbOperation::ListEvents))
        .await
        .unwrap();
    let expected_events = arlesh_lib::commands::knowledge_base::list_events(app.state())
        .await
        .unwrap();
    assert_eq!(
        payload(&events),
        &serde_json::to_value(&expected_events).unwrap(),
        "kb.list_events"
    );

    let threads = mcp
        .kb(Parameters(params::KbOperation::ListThreads))
        .await
        .unwrap();
    let expected_threads = arlesh_lib::commands::knowledge_base::list_threads(app.state())
        .await
        .unwrap();
    assert_eq!(
        payload(&threads),
        &serde_json::to_value(&expected_threads).unwrap(),
        "kb.list_threads"
    );
}

#[tokio::test]
async fn flows_reads_match_their_commands() {
    use arlesh_lib::commands::flows as flow_commands;
    use arlesh_lib::flows::model::{CreateFlowRequest, InstanceType};

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = ArleshMcp::new(helpers::session_factory(&pool));

    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Routine".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let got = mcp
        .flows(Parameters(params::FlowsOperation::Get { id: flow.id }))
        .await
        .unwrap();
    let expected = flow_commands::get_flow(app.state(), flow.id).await.unwrap();
    assert_eq!(
        payload(&got),
        &serde_json::to_value(&expected).unwrap(),
        "flows.get"
    );

    // A flow that is not a Habit has no recurrence: `null` is the answer, not an error.
    let recurrence = mcp
        .flows(Parameters(params::FlowsOperation::Recurrence {
            flow_id: flow.id,
        }))
        .await
        .unwrap();
    assert_eq!(payload(&recurrence), &serde_json::Value::Null);

    let count = mcp
        .flows(Parameters(params::FlowsOperation::CompletionCount {
            flow_id: flow.id,
        }))
        .await
        .unwrap();
    let expected_count = flow_commands::habit_completion_count(app.state(), flow.id)
        .await
        .unwrap();
    assert_eq!(
        payload(&count),
        &serde_json::to_value(expected_count).unwrap(),
        "flows.completion_count"
    );

    let origins = mcp
        .flows(Parameters(params::FlowsOperation::Origins {
            nodes: vec![params::NodeRef {
                node_type: "task".into(),
                node_id: 1,
            }],
        }))
        .await
        .unwrap();
    let expected_origins = flow_commands::flow_origins(
        app.state(),
        vec![arlesh_lib::flows::model::TargetRef {
            node_type: "task".into(),
            node_id: 1,
        }],
    )
    .await
    .unwrap();
    assert_eq!(
        payload(&origins),
        &serde_json::to_value(&expected_origins).unwrap(),
        "flows.origins"
    );
}

#[test]
fn the_port_falls_back_when_the_override_is_unparseable() {
    // A typo in the environment must not stop the app serving MCP at all.
    temp_env_var(arlesh_lib::mcp::PORT_ENV_VAR, "not-a-port", || {
        assert_eq!(arlesh_lib::mcp::port(), arlesh_lib::mcp::DEFAULT_PORT);
    });
    temp_env_var(arlesh_lib::mcp::PORT_ENV_VAR, "5151", || {
        assert_eq!(arlesh_lib::mcp::port(), 5151);
    });
}

/// Runs `body` with `key` set to `value`, restoring the previous value afterwards.
fn temp_env_var(key: &str, value: &str, body: impl FnOnce()) {
    let previous = std::env::var(key).ok();
    // SAFETY: this test is the only thing touching the variable, and it is restored before
    // returning. `set_var` is unsafe from Rust 2024 because another thread reading the
    // environment concurrently is UB; nothing else here reads it.
    unsafe { std::env::set_var(key, value) };
    body();
    match previous {
        Some(old) => unsafe { std::env::set_var(key, old) },
        None => unsafe { std::env::remove_var(key) },
    }
}
