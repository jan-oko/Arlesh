//! The agent capacity lock over the MCP: reading and setting it, sharing it with the app, and the
//! block it derives — the same in the snapshot, in `get` and in the app's own load.

use crate::helpers;
use helpers::StoredId;

use arlesh_lib::capacity::AgentCapacity;
use arlesh_lib::filters::model::{BoardFilter, Preset};
use arlesh_lib::mcp::{params, ArleshMcp};
use arlesh_lib::nodes::id::NodeId;
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

/// A To Do Task under the root Aspect, marked Agentic when `agentic`.
async fn task(
    app: &tauri::App<tauri::test::MockRuntime>,
    pool: &sqlx::SqlitePool,
    title: &str,
    agentic: bool,
) -> i64 {
    use arlesh_lib::commands::tasks as task_commands;
    use arlesh_lib::tasks::model::CreateTaskRequest;

    let id = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: title.into(),
            parent_type: "domain".into(),
            parent_id: 1.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
    .sid();
    if agentic {
        helpers::make_agentic(pool, id).await;
    }
    id
}

async fn start(mcp: &ArleshMcp) -> CallToolResult {
    let result = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: None,
            sections: None,
            cursor: None,
            filter: Some(BoardFilter::preset(Preset::Start)),
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
    result
}

#[tokio::test]
async fn while_the_lock_is_on_the_snapshots_start_offers_no_agentic_work() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let agentic = task(&app, &pool, "Agent work", true).await;
    let plain = task(&app, &pool, "My work", false).await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let mut open = task_ids(&start(&mcp).await);
    open.sort_unstable();
    assert_eq!(open, vec![agentic, plain], "with room, Start offers both");

    run(&mcp, CapacityOperation::Set { at_capacity: true }).await;
    let at_capacity = start(&mcp).await;
    assert_eq!(
        task_ids(&at_capacity),
        vec![plain],
        "at capacity, the Agentic task is blocked and Start drops it"
    );

    run(&mcp, CapacityOperation::Set { at_capacity: false }).await;
    assert_eq!(
        task_ids(&start(&mcp).await).len(),
        2,
        "clearing the lock unblocks it"
    );
}

#[tokio::test]
async fn the_snapshot_and_get_carry_the_derived_reason() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let agentic = task(&app, &pool, "Agent work", true).await;
    let mcp = helpers::mcp_over_whole_board(&pool).await;
    run(&mcp, CapacityOperation::Set { at_capacity: true }).await;

    let whole = mcp
        .snapshot(Parameters(params::SnapshotOperation::Load {
            now: None,
            sections: Some(vec![arlesh_lib::mcp::paging::Section::BlockReasons]),
            cursor: None,
            filter: None,
            agentic: None,
        }))
        .await
        .unwrap();
    let reasons = whole
        .structured_content
        .as_ref()
        .and_then(|payload| payload.get("block_reasons"))
        .and_then(|section| section.as_array())
        .cloned()
        .expect("a block_reasons section");
    assert!(
        reasons.iter().any(|reason| {
            reason["owner_type"] == "task"
                && reason["owner_id"] == agentic
                && reason["reason"] == "Agents at capacity"
                && reason["derived"] == "agent_capacity"
        }),
        "{reasons:?}"
    );

    let got = mcp
        .tasks(Parameters(params::TasksOperation::Get {
            id: agentic.into(),
        }))
        .await
        .unwrap();
    let body = got.structured_content.expect("get answers");
    assert_eq!(
        body["block_reasons"],
        serde_json::json!(["Agents at capacity"])
    );
}

#[tokio::test]
async fn the_apps_load_is_blocked_by_the_lock_the_app_holds() {
    use arlesh_lib::commands::mindmap::load_mindmap;

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let agentic = task(&app, &pool, "Agent work", true).await;
    let now = chrono::Local::now().naive_local();

    let before = load_mindmap(app.state(), app.state(), now).await.unwrap();
    assert!(before.block_reasons.is_empty());

    app.state::<AgentCapacity>().set(true).await.unwrap();
    let after = load_mindmap(app.state(), app.state(), now).await.unwrap();
    assert_eq!(after.block_reasons.len(), 1);
    assert_eq!(after.block_reasons[0].owner_id, NodeId::from(agentic));
    assert!(after.block_reasons[0].derived.is_some());
}

#[tokio::test]
async fn a_compound_whose_open_items_the_lock_blocks_is_blocked_too() {
    use arlesh_lib::block_reasons::model::DerivedBlock;
    use arlesh_lib::commands::mindmap::load_mindmap;
    use arlesh_lib::commands::tasks as task_commands;
    use arlesh_lib::tasks::model::CreateTaskRequest;

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    // A Compound Task of my own, holding one Agentic step.
    let compound = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Ship it".into(),
            parent_type: "domain".into(),
            parent_id: 1.into(),
            compound: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
    .sid();
    let step = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Agent step".into(),
            parent_type: "task".into(),
            parent_id: compound.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
    .sid();
    helpers::make_agentic(&pool, step).await;
    let now = chrono::Local::now().naive_local();
    let derived_on = |load: &arlesh_lib::mindmap::model::MindmapLoad, id: i64| {
        load.block_reasons
            .iter()
            .filter(|reason| reason.owner_id == NodeId::from(id))
            .filter_map(|reason| reason.derived)
            .collect::<Vec<_>>()
    };

    let free = load_mindmap(app.state(), app.state(), now).await.unwrap();
    assert!(
        derived_on(&free, compound).is_empty(),
        "its one open item is free"
    );

    app.state::<AgentCapacity>().set(true).await.unwrap();
    let locked = load_mindmap(app.state(), app.state(), now).await.unwrap();
    assert_eq!(derived_on(&locked, step), vec![DerivedBlock::AgentCapacity]);
    assert_eq!(
        derived_on(&locked, compound),
        vec![DerivedBlock::Compound],
        "the lock blocks its only open item, so the Compound is blocked as well"
    );
}
