//! Tool-level tests for the MCP server.
//!
//! The tools are a second adapter over the same session layer `commands/` uses, so the property
//! worth proving is **equivalence**: a tool must return what the command it stands in for returns,
//! on the wire. Comparing `serde_json::Value` rather than the models themselves is deliberate —
//! most of these types derive no `PartialEq`, and the wire form is what an agent actually receives.
//!
//! The pool has **one** connection (see [`helpers::test_pool`]), so every assertion reads it only
//! after the tool's session has closed.

use crate::helpers;

use arlesh_lib::mcp::{params, ArleshMcp};
use arlesh_lib::scopes::key::ScopeKey;
use helpers::StoredId;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use tauri::Manager;

/// A key as an MCP caller sends it: the same JSON object, through the tool's own parameter type.
fn param(key: ScopeKey) -> params::ScopeKeyParam {
    serde_json::from_value(serde_json::to_value(key).unwrap()).unwrap()
}

/// A key parameter from JSON text.
fn param_of(text: &str) -> params::ScopeKeyParam {
    serde_json::from_str(text).unwrap()
}

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
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    // No scope has to exist first: a scope is derived from its key.
    let week = arlesh_lib::commands::scopes::scope_containing(
        arlesh_lib::scopes::model::ScopeKind::Week,
        "2026-02-02".into(),
    )
    .unwrap();

    let result = mcp
        .scopes(Parameters(params::ScopesOperation::Get {
            id: param(week.id),
        }))
        .await
        .unwrap();

    let expected = arlesh_lib::commands::scopes::get_scope(week.id);
    assert_eq!(
        payload(&result),
        &serde_json::to_value(&expected).unwrap(),
        "scopes.get"
    );
    assert_eq!(
        week.id.canonical(),
        r#"{"kind":"week","date":"2026-02-01"}"#
    );
}

#[tokio::test]
async fn scopes_get_on_a_malformed_key_reports_an_invalid_request() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    // A Wednesday is not the start of a week, so this names no scope.
    let result = mcp
        .scopes(Parameters(params::ScopesOperation::Get {
            id: param_of(r#"{"kind":"week","date":"2026-02-04"}"#),
        }))
        .await
        .unwrap();

    // The point of routing through `WireError` rather than stringifying: the agent gets the same
    // machine-readable discriminant the frontend does, not prose it has to pattern-match on.
    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("invalid_request"),
    );
}

#[tokio::test]
async fn scopes_resolve_many_resolves_each_id_in_order() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let ids: Vec<params::ScopeKeyParam> = [
        r#"{"kind":"week","date":"2026-02-01"}"#,
        r#"{"kind":"day","date":"2026-02-09"}"#,
        r#"{"kind":"month","date":"2026-02-01"}"#,
    ]
    .iter()
    .map(|text| param_of(text))
    .collect();

    let result = mcp
        .scopes(Parameters(params::ScopesOperation::ResolveMany { ids }))
        .await
        .unwrap();

    // Order matters: the caller pairs results back to the ids it sent positionally.
    let starts: Vec<&str> = payload(&result)
        .as_array()
        .expect("resolve_many answers a list")
        .iter()
        .map(|resolved| resolved["start"].as_str().unwrap())
        .collect();
    assert_eq!(
        starts,
        [
            "2026-02-01T02:00:00",
            "2026-02-09T02:00:00",
            "2026-02-01T02:00:00"
        ],
        "scopes.resolve_many"
    );
}

#[tokio::test]
async fn kb_lists_match_their_commands() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let ada = arlesh_lib::commands::knowledge_base::create_person(
        app.state(),
        arlesh_lib::knowledge_base::model::CreatePersonRequest {
            name: "Ada".into(),
            aliases: None,
            linked_note: None,
        },
    )
    .await
    .unwrap();
    // A Person hangs on no node, so the MCP sees one only through a node it can read.
    delegate(&pool, seed(&app).await, ada.id).await;

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

/// Delegates a Task to a Person, straight to the columns.
async fn delegate(pool: &sqlx::SqlitePool, task_id: i64, person_id: i64) {
    sqlx::query("UPDATE tasks SET delegate_kind = 'person', delegate_id = ? WHERE id = ?")
        .bind(person_id)
        .bind(task_id)
        .execute(pool)
        .await
        .unwrap();
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
            parent_id: 1.into(),
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
            parent_id: goal.id.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
    .sid()
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
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    // `ArleshMcp::new` sums seven routers. Drop one and nothing fails to compile — the tool simply
    // stops being served, which an agent would discover and this test does not let pass silently.
    assert_eq!(
        mcp.tool_names(),
        vec![
            "arlesh_beads",
            "arlesh_flows",
            "arlesh_kb",
            "arlesh_scopes",
            "arlesh_snapshot",
            "arlesh_tasks",
            "arlesh_waits",
        ]
    );
}

#[tokio::test]
async fn snapshot_returns_what_the_mindmap_command_returns() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    seed(&app).await;

    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: now(),
            sections: None,
            cursor: None,
            filter: None,
            agentic: None,
        }))
        .await
        .unwrap();

    // Paging adds an envelope field and changes nothing else. Comparing the sections against the
    // command keeps the property the whole adapter rests on — the agent sees what the app sees —
    // while letting the cursor ride alongside.
    let mut sections = payload(&result).clone();
    let cursor = sections
        .as_object_mut()
        .expect("the payload is an object")
        .remove("next_cursor")
        .expect("a paged response always says whether more remains");
    // Each node carries its short id beside its id, which the app's own payload has no use for.
    let mut named = 0;
    for (section, items) in sections.as_object_mut().expect("an object").iter_mut() {
        for item in items.as_array_mut().into_iter().flatten() {
            if let Some(short) = item
                .as_object_mut()
                .and_then(|item| item.remove("short_id"))
            {
                assert!(
                    short.as_str().is_some_and(|short| short.len() >= 3),
                    "{section}"
                );
                named += 1;
            }
        }
    }
    assert!(named > 0, "the snapshot names its nodes by short id");

    let expected = arlesh_lib::commands::mindmap::load_mindmap(app.state(), now())
        .await
        .unwrap();
    assert_eq!(
        sections,
        serde_json::to_value(&expected).unwrap(),
        "snapshot.load section-for-section"
    );
    assert!(
        cursor.is_null(),
        "a seeded board fits in one page, so nothing should remain: {cursor}"
    );
}

#[tokio::test]
async fn snapshot_narrows_to_the_status_preset_it_is_given() {
    use arlesh_lib::filters::model::{BoardFilter, Preset};

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    let task_id = seed(&app).await;

    // The seeded task is To Do, so Do should hold nothing at all while Plan still holds it. The
    // preset rules themselves are pinned by the shared conformance corpus; what this proves is
    // that the tool reaches them, and that it cuts the derived sections to match.
    let planned = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: now(),
            sections: None,
            cursor: None,
            filter: Some(BoardFilter::preset(Preset::Plan)),
            agentic: None,
        }))
        .await
        .unwrap();
    assert_eq!(task_ids(&planned), vec![task_id]);

    let doing = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: now(),
            sections: None,
            cursor: None,
            filter: Some(BoardFilter::preset(Preset::Do)),
            agentic: None,
        }))
        .await
        .unwrap();
    assert!(
        task_ids(&doing).is_empty(),
        "a To Do task is not in progress"
    );
    assert!(
        payload(&doing)
            .get("lifecycles")
            .and_then(|section| section.as_array())
            .is_some_and(|items| items.is_empty()),
        "the derived sections are cut to the nodes that survived"
    );
    assert!(
        payload(&doing)
            .get("goals")
            .and_then(|section| section.as_array())
            .is_some_and(|items| items.is_empty()),
        "a goal shows only as the ancestor of a content match, and there is none"
    );
}

/// The ids in a snapshot payload's `tasks` section.
fn task_ids(result: &CallToolResult) -> Vec<i64> {
    payload(result)
        .get("tasks")
        .and_then(|section| section.as_array())
        .expect("the payload carries a tasks section")
        .iter()
        .filter_map(|task| task.get("id").and_then(serde_json::Value::as_i64))
        .collect()
}

#[tokio::test]
async fn snapshot_writes_nothing() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    seed(&app).await;

    // Deriving habit iterations used to mint the scope rows their windows landed on, so the
    // snapshot had to commit. Scopes are derived now (ADR 0009): the test pool is one connection,
    // so its change counter sees every row anything writes through it.
    let before = helpers::total_changes(&pool).await;

    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: now(),
            sections: None,
            cursor: None,
            filter: None,
            agentic: None,
        }))
        .await
        .unwrap();
    assert_ne!(result.is_error, Some(true));

    assert_eq!(
        helpers::total_changes(&pool).await,
        before,
        "a snapshot is a read"
    );
}

#[tokio::test]
async fn tasks_get_returns_what_the_command_returns() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    let task_id = seed(&app).await;

    let result = mcp
        .tasks(Parameters(params::TasksOperation::Get {
            id: task_id.into(),
        }))
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
async fn tasks_get_on_a_missing_id_is_not_permitted() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let result = mcp
        .tasks(Parameters(params::TasksOperation::Get {
            id: 99_999_i64.into(),
        }))
        .await
        .unwrap();

    // Not `not_found`: a node that is not there and a node the MCP may not see answer alike, so
    // the error kind cannot be used to find out what exists outside the roots.
    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("not_permitted"),
    );
}

#[tokio::test]
async fn tasks_containment_conflicts_matches_the_command() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    let task_id = seed(&app).await;

    let scope = arlesh_lib::commands::scopes::scope_containing(
        arlesh_lib::scopes::model::ScopeKind::Week,
        "2026-02-02".into(),
    )
    .unwrap();

    let result = mcp
        .tasks(Parameters(params::TasksOperation::ContainmentConflicts {
            node: params::NodeRef {
                node_type: "task".into(),
                node_id: task_id.into(),
            },
            time_scope: params::TimeScope {
                start_id: param(scope.id),
                end_id: param(scope.id),
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
    let mcp = helpers::mcp_over_whole_board(&pool).await;

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
    delegate(&pool, seed(&app).await, person.id).await;

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
    let mcp = helpers::mcp_over_whole_board(&pool).await;

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
        .flows(Parameters(params::FlowsOperation::Get {
            id: flow.id.into(),
        }))
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
            flow_id: flow.id.into(),
        }))
        .await
        .unwrap();
    assert_eq!(payload(&recurrence), &serde_json::Value::Null);

    let count = mcp
        .flows(Parameters(params::FlowsOperation::CompletionCount {
            flow_id: flow.id.into(),
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

    // A node named here has to be one the MCP can see, so it has to exist.
    let task_id = seed(&app).await;
    let origins = mcp
        .flows(Parameters(params::FlowsOperation::Origins {
            nodes: vec![params::NodeRef {
                node_type: "task".into(),
                node_id: task_id.into(),
            }],
        }))
        .await
        .unwrap();
    let expected_origins = flow_commands::flow_origins(
        app.state(),
        vec![arlesh_lib::flows::model::TargetRef {
            node_type: "task".into(),
            node_id: task_id,
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

/// Reads a `beads_id` straight off the pool.
///
/// Read only after the tool's session has closed — the test pool has one connection.
async fn stored_beads_id(pool: &sqlx::SqlitePool, table: &str, id: i64) -> Option<String> {
    sqlx::query_scalar(&format!("SELECT beads_id FROM {table} WHERE id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn beads_set_links_a_task_and_then_clears_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    let task_id = seed(&app).await;
    helpers::make_agentic(&pool, task_id).await;

    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: task_id.into(),
            beads_id: Some("Arlesh-5fs".into()),
        }))
        .await
        .unwrap();

    // The tool echoes the link back so a caller sees what now stands without a second read.
    assert_eq!(
        payload(&result).get("beads_id").and_then(|v| v.as_str()),
        Some("Arlesh-5fs")
    );
    assert_eq!(
        stored_beads_id(&pool, "tasks", task_id).await,
        Some("Arlesh-5fs".into())
    );

    let cleared = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: task_id.into(),
            beads_id: None,
        }))
        .await
        .unwrap();
    assert_ne!(cleared.is_error, Some(true));
    assert_eq!(stored_beads_id(&pool, "tasks", task_id).await, None);
}

#[tokio::test]
async fn beads_set_refuses_a_goal_because_only_an_agentic_task_is_writable() {
    use arlesh_lib::commands::tasks as task_commands;
    use arlesh_lib::tasks::model::CreateGoalRequest;

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let goal = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Ship".into(),
            parent_type: "domain".into(),
            parent_id: 1.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Goal,
            node_id: goal.id.sid().into(),
            beads_id: Some("Arlesh-32r".into()),
        }))
        .await
        .unwrap();

    // Inside a root a Goal is readable, never writable: an agent performs actions, and only a
    // Task is ever Agentic.
    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("not_permitted"),
    );
    assert_eq!(stored_beads_id(&pool, "goals", goal.id.sid()).await, None);
}

#[tokio::test]
async fn beads_set_refuses_a_project_because_only_an_agentic_task_is_writable() {
    use arlesh_lib::commands::domains as domain_commands;
    use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype};

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let project = domain_commands::create_domain(
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

    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Project,
            node_id: project.id.into(),
            beads_id: Some("Arlesh-e8d".into()),
        }))
        .await
        .unwrap();

    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("not_permitted"),
    );
    assert_eq!(stored_beads_id(&pool, "domains", project.id).await, None);
}

#[tokio::test]
async fn beads_set_refuses_a_domain_that_is_not_a_project() {
    use arlesh_lib::commands::domains as domain_commands;
    use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype};

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let plain_domain = domain_commands::create_domain(
        app.state(),
        CreateDomainRequest {
            title: "Reference".into(),
            description: None,
            subtype: DomainSubtype::Domain,
            parent_id: Some(1),
            status: None,
            knowledge_base_directory: None,
        },
    )
    .await
    .unwrap();

    // Refused before the subtype is even looked at: no domain-table row is ever writable.
    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Project,
            node_id: plain_domain.id.into(),
            beads_id: Some("Arlesh-5fs".into()),
        }))
        .await
        .unwrap();

    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("not_permitted"),
    );
    assert_eq!(
        stored_beads_id(&pool, "domains", plain_domain.id).await,
        None,
        "the refused write must not have landed"
    );
}

#[tokio::test]
async fn beads_set_on_a_missing_item_is_not_permitted() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    // "Succeeded" for a write that landed nowhere is the wrong answer to hand an agent acting on
    // an id it was given.
    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: 99_999_i64.into(),
            beads_id: Some("Arlesh-5fs".into()),
        }))
        .await
        .unwrap();

    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("not_permitted"),
    );
}

#[tokio::test]
async fn the_snapshot_carries_a_beads_id_once_it_is_set() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    let task_id = seed(&app).await;
    helpers::make_agentic(&pool, task_id).await;

    mcp.beads(Parameters(params::BeadsOperation::Set {
        node_type: params::BeadsNode::Task,
        node_id: task_id.into(),
        beads_id: Some("Arlesh-5fs".into()),
    }))
    .await
    .unwrap();

    // The whole point of the field: an agent sets the link and then sees it in the same payload it
    // reads everything else from, without a per-item lookup.
    let snapshot = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: now(),
            sections: None,
            cursor: None,
            filter: None,
            agentic: None,
        }))
        .await
        .unwrap();

    let tasks = payload(&snapshot)
        .get("tasks")
        .and_then(|t| t.as_array())
        .expect("snapshot carried no tasks");
    let linked = tasks
        .iter()
        .find(|t| t.get("id").and_then(|i| i.as_i64()) == Some(task_id))
        .expect("seeded task missing from snapshot");
    assert_eq!(
        linked.get("beads_id").and_then(|v| v.as_str()),
        Some("Arlesh-5fs")
    );
}

#[tokio::test]
async fn scopes_resolve_matches_the_command() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let scope = arlesh_lib::commands::scopes::scope_containing(
        arlesh_lib::scopes::model::ScopeKind::Week,
        "2026-02-02".into(),
    )
    .unwrap();

    let result = mcp
        .scopes(Parameters(params::ScopesOperation::Resolve {
            id: param(scope.id),
        }))
        .await
        .unwrap();

    let expected = arlesh_lib::commands::scopes::resolve_scope(scope.id);
    assert_eq!(
        payload(&result),
        &serde_json::to_value(&expected).unwrap(),
        "scopes.resolve"
    );
}

#[tokio::test]
async fn scopes_resolve_on_an_impossible_date_reports_an_invalid_request() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let result = mcp
        .scopes(Parameters(params::ScopesOperation::Resolve {
            id: param_of(r#"{"kind":"day","date":"2026-02-31"}"#),
        }))
        .await
        .unwrap();

    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("invalid_request"),
    );
}

#[tokio::test]
async fn a_duration_carries_through_to_the_domain_window() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    let task_id = seed(&app).await;

    let start = arlesh_lib::commands::scopes::scope_containing(
        arlesh_lib::scopes::model::ScopeKind::Week,
        "2026-02-02".into(),
    )
    .unwrap();
    let end = arlesh_lib::commands::scopes::scope_containing(
        arlesh_lib::scopes::model::ScopeKind::Week,
        "2026-02-09".into(),
    )
    .unwrap();

    // The MCP window types are a separate mirror of the domain ones, so the conversion between
    // them is real code that can drift. A window in duration form is the shape that exercises it.
    let mcp_window = params::TimeScope {
        start_id: param(start.id),
        end_id: param(end.id),
        duration: Some(params::DurationSpec {
            n: 2,
            kind: "week".into(),
        }),
    };
    let domain_window = arlesh_lib::tasks::model::TimeScope {
        start_id: start.id,
        end_id: end.id,
        duration: Some(arlesh_lib::tasks::model::DurationSpec {
            n: 2,
            kind: "week".into(),
        }),
    };

    let result = mcp
        .tasks(Parameters(params::TasksOperation::ContainmentConflicts {
            node: params::NodeRef {
                node_type: "task".into(),
                node_id: task_id.into(),
            },
            time_scope: mcp_window,
        }))
        .await
        .unwrap();

    let expected = arlesh_lib::commands::tasks::scope_containment_conflicts(
        app.state(),
        "task".into(),
        task_id,
        domain_window,
    )
    .await
    .unwrap();
    assert_eq!(
        payload(&result),
        &serde_json::to_value(&expected).unwrap(),
        "containment_conflicts with a duration window"
    );
}

/// Loads one page.
async fn page_of(
    mcp: &ArleshMcp,
    sections: Option<Vec<arlesh_lib::mcp::paging::Section>>,
    cursor: Option<String>,
) -> serde_json::Value {
    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: now(),
            sections,
            cursor,
            filter: None,
            agentic: None,
        }))
        .await
        .unwrap();
    payload(&result).clone()
}

/// Seeds enough tasks that the payload cannot fit in a single page.
async fn seed_many_tasks(app: &tauri::App<tauri::test::MockRuntime>, count: usize) {
    use arlesh_lib::commands::tasks as task_commands;
    use arlesh_lib::tasks::model::CreateTaskRequest;

    let goal_id = 1;
    for n in 0..count {
        task_commands::create_task(
            app.state(),
            CreateTaskRequest {
                // Padded so the budget is reached without needing thousands of rows.
                title: format!("Task {n} {}", "x".repeat(300)),
                parent_type: "goal".into(),
                parent_id: goal_id.into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn a_board_too_big_for_one_page_is_handed_over_across_several() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    seed(&app).await;
    seed_many_tasks(&app, 200).await;

    // This is the bug the whole change exists for: one call used to return the entire board, and
    // on a real one that overran the client's tool-result limit.
    let mut cursor = None;
    let mut tasks_seen: Vec<i64> = Vec::new();
    let mut pages = 0;

    loop {
        let page = page_of(&mcp, None, cursor.clone()).await;
        pages += 1;
        assert!(pages < 100, "paging did not terminate");

        if let Some(tasks) = page.get("tasks").and_then(|t| t.as_array()) {
            tasks_seen.extend(tasks.iter().filter_map(|t| t.get("id")?.as_i64()));
        }

        match page.get("next_cursor").and_then(|c| c.as_str()) {
            Some(next) => cursor = Some(next.to_string()),
            None => break,
        }
    }

    assert!(pages > 1, "200 padded tasks should not fit in one page");

    let expected = arlesh_lib::commands::mindmap::load_mindmap(app.state(), now())
        .await
        .unwrap();
    let expected_ids: Vec<i64> = expected.tasks.iter().map(|task| task.id.sid()).collect();
    assert_eq!(
        tasks_seen, expected_ids,
        "paging must yield every task exactly once, in order"
    );
}

#[tokio::test]
async fn each_page_stays_under_the_budget() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    seed(&app).await;
    seed_many_tasks(&app, 200).await;

    // The budget is the whole point — a page that overruns it fails for the same reason the
    // unpaged response did.
    let mut cursor = None;
    loop {
        let page = page_of(&mcp, None, cursor.clone()).await;
        let size = page.to_string().len();
        assert!(
            size < 60_000,
            "a page came to {size} characters, which defeats the purpose"
        );
        match page.get("next_cursor").and_then(|c| c.as_str()) {
            Some(next) => cursor = Some(next.to_string()),
            None => break,
        }
    }
}

#[tokio::test]
async fn sections_fetches_only_what_was_asked_for() {
    use arlesh_lib::mcp::paging::Section;

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    seed(&app).await;

    let page = page_of(&mcp, Some(vec![Section::Tasks, Section::Lifecycles]), None).await;

    let keys: Vec<&str> = page
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .filter(|key| *key != "next_cursor")
        .collect();
    assert_eq!(
        keys,
        vec!["lifecycles", "tasks"],
        "asking for two sections should not pay for the other twelve"
    );
}

#[tokio::test]
async fn an_empty_section_is_returned_as_empty_rather_than_omitted() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    seed(&app).await;

    // Omitted means "not reached yet" and `[]` means "none". An agent that could not tell them
    // apart would report a board has no flows when it has simply not paged that far.
    let page = page_of(&mcp, None, None).await;

    assert_eq!(
        page.get("block_reasons"),
        Some(&serde_json::json!([])),
        "a genuinely empty section belongs in the page"
    );
}

#[tokio::test]
async fn a_cursor_the_server_never_issued_is_refused() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    for bad in ["not-a-cursor", "nosuchsection:0", "tasks:oops"] {
        let result = mcp
            .snapshot(Parameters(params::SnapshotOperation::Load {
                now: now(),
                sections: None,
                cursor: Some(bad.into()),
                filter: None,
                agentic: None,
            }))
            .await
            .unwrap();

        assert_eq!(
            error_payload(&result).get("kind").and_then(|k| k.as_str()),
            Some("invalid_request"),
            "cursor {bad:?} should be refused, not guessed at"
        );
    }
}

#[tokio::test]
async fn an_empty_sections_list_is_refused_rather_than_returning_nothing() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    // Silently returning an empty page would read as "your board is empty".
    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: now(),
            sections: Some(vec![]),
            cursor: None,
            filter: None,
            agentic: None,
        }))
        .await
        .unwrap();

    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("invalid_request"),
    );
}

#[tokio::test]
async fn beads_set_refuses_a_commitment_because_only_an_agentic_task_is_writable() {
    use arlesh_lib::commands::commitments as commitment_commands;
    use arlesh_lib::scopes::model::ScopeKind;
    use arlesh_lib::tasks::model::{CreateCommitmentRequest, TimeScope};

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let scope = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
    )
    .unwrap();

    let commitment = commitment_commands::create_commitment(
        app.state(),
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "domain".into(),
            parent_id: 1.into(),
            time_scope: Some(TimeScope {
                start_id: scope.id,
                end_id: scope.id,
                duration: None,
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Commitment,
            node_id: commitment.id.sid().into(),
            beads_id: Some("Arlesh-cyo".into()),
        }))
        .await
        .unwrap();

    assert_eq!(
        error_payload(&result).get("kind").and_then(|k| k.as_str()),
        Some("not_permitted"),
    );
    assert_eq!(
        stored_beads_id(&pool, "commitments", commitment.id.sid()).await,
        None
    );
}

#[tokio::test]
async fn beads_set_on_a_commitment_that_does_not_exist_is_an_error() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let result = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Commitment,
            node_id: 9999_i64.into(),
            beads_id: Some("Arlesh-cyo".into()),
        }))
        .await
        .unwrap();
    assert_eq!(
        result.is_error,
        Some(true),
        "a write that landed nowhere is not a success"
    );
}
