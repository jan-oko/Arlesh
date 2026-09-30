//! The agent capacity lock over the MCP: reading and setting it, sharing it with the app, and the
//! one thing it must never do — narrow what an agent reads.

use crate::helpers;
use helpers::StoredId;

use arlesh_lib::capacity::AgentCapacity;
use arlesh_lib::filters::model::{BoardFilter, Preset};
use arlesh_lib::mcp::{params, ArleshMcp};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use tauri::Manager;

use params::CapacityOperation;

async fn run(mcp: &ArleshMcp, operation: CapacityOperation) -> serde_json::Value {
    let result = mcp
        .capacity(Parameters(operation))
        .await
        .expect("the capacity tool returned no result");
    assert_ne!(
        result.is_error,
        Some(true),
        "{:?}",
        result.structured_content
    );
    result
        .structured_content
        .expect("the capacity tool carried no structured content")
}

#[tokio::test]
async fn the_lock_starts_off_and_holds_what_an_agent_sets() {
    let pool = helpers::test_pool().await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    assert_eq!(
        run(&mcp, CapacityOperation::Get).await,
        serde_json::json!({ "at_capacity": false })
    );
    assert_eq!(
        run(&mcp, CapacityOperation::Set { at_capacity: true }).await,
        serde_json::json!({ "at_capacity": true }),
        "set answers with the state it left"
    );
    assert_eq!(
        run(&mcp, CapacityOperation::Get).await,
        serde_json::json!({ "at_capacity": true })
    );
    run(&mcp, CapacityOperation::Set { at_capacity: false }).await;
    assert_eq!(
        run(&mcp, CapacityOperation::Get).await,
        serde_json::json!({ "at_capacity": false })
    );
}

#[tokio::test]
async fn an_agent_and_the_app_share_one_lock() {
    let pool = helpers::test_pool().await;
    let capacity = AgentCapacity::in_memory();
    let mcp = helpers::mcp_over_whole_board(&pool)
        .await
        .with_capacity(capacity.clone());

    run(&mcp, CapacityOperation::Set { at_capacity: true }).await;
    assert!(
        capacity.get().await.at_capacity,
        "the app sees what the agent set"
    );

    capacity.set(false).await.unwrap();
    assert_eq!(
        run(&mcp, CapacityOperation::Get).await,
        serde_json::json!({ "at_capacity": false }),
        "the agent reads what the app set"
    );
}

/// The ids in a snapshot payload's `tasks` section.
fn task_ids(result: &CallToolResult) -> Vec<i64> {
    result
        .structured_content
        .as_ref()
        .and_then(|payload| payload.get("tasks"))
        .and_then(|section| section.as_array())
        .expect("the payload carries a tasks section")
        .iter()
        .filter_map(|task| task.get("id").and_then(serde_json::Value::as_i64))
        .collect()
}

#[tokio::test]
async fn the_snapshots_start_filter_ignores_the_lock() {
    use arlesh_lib::commands::tasks as task_commands;
    use arlesh_lib::tasks::model::CreateTaskRequest;

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let task_id = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Agent work".into(),
            parent_type: "domain".into(),
            parent_id: 1.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
    .sid();
    helpers::make_agentic(&pool, task_id).await;
    let capacity = AgentCapacity::in_memory();
    capacity.set(true).await.unwrap();
    let mcp = helpers::mcp_over_whole_board(&pool)
        .await
        .with_capacity(capacity);

    // The filter has no field for the lock — the app fills its own in on the frontend — so even a
    // caller that names one gets it ignored rather than applied.
    let filters = [
        BoardFilter::preset(Preset::Start),
        serde_json::from_value(serde_json::json!({
            "preset": "start",
            "start_hides_agentic": true,
            "agents_at_capacity": true,
        }))
        .unwrap(),
    ];
    for filter in filters {
        let result = mcp
            .snapshot(Parameters(params::SnapshotOperation::Load {
                now: None,
                sections: None,
                cursor: None,
                filter: Some(filter),
                agentic: None,
            }))
            .await
            .unwrap();
        assert_ne!(
            result.is_error,
            Some(true),
            "{:?}",
            result.structured_content
        );
        assert_eq!(
            task_ids(&result),
            vec![task_id],
            "an Agentic To Do task is still startable to an agent while the lock is on"
        );
    }
}
