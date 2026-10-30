//! Command-level tests for the gesture operations: a gesture over several nodes, as one command.
//! The server runs the same operation for its `/gestures` routes, through the bindings.

use crate::helpers;

use arlesh_lib::commands::{node_gestures, tasks as task_commands};
use arlesh_lib::nodes::gestures::GestureNode;
use arlesh_lib::tasks::model::{CreateTaskRequest, Task};
use tauri::Manager;

async fn task(app: &tauri::App<tauri::test::MockRuntime>, title: &str) -> Task {
    task_commands::create_task(
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
}

fn node(kind: &str, task: &Task) -> GestureNode {
    GestureNode {
        kind: kind.into(),
        id: task.id.clone(),
    }
}

async fn exists(app: &tauri::App<tauri::test::MockRuntime>, task: &Task) -> bool {
    let id = task.id.stored().expect("a stored task");
    task_commands::get_task(app.state(), id).await.is_ok()
}

#[tokio::test]
async fn deleting_several_nodes_deletes_each() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let first = task(&app, "First").await;
    let second = task(&app, "Second").await;

    node_gestures::delete_nodes(
        app.state(),
        vec![node("task", &first), node("task", &second)],
    )
    .await
    .unwrap();

    assert!(!exists(&app, &first).await);
    assert!(!exists(&app, &second).await);
}

#[tokio::test]
async fn a_delete_refused_part_way_deletes_nothing() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let first = task(&app, "First").await;
    let aspect = GestureNode {
        kind: "aspect".into(),
        id: 1.into(),
    };

    let refused =
        node_gestures::delete_nodes(app.state(), vec![node("task", &first), aspect]).await;

    assert!(refused.is_err());
    assert!(
        exists(&app, &first).await,
        "the first delete was rolled back"
    );
}

#[tokio::test]
async fn every_deletable_kind_is_deleted_by_its_own_writer() {
    use arlesh_lib::commands::{domains, flows, infos};
    use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype};
    use arlesh_lib::flows::model::{CreateFlowItemRequest, CreateFlowRequest, InstanceType};
    use arlesh_lib::infos::model::CreateInfoRequest;
    use arlesh_lib::tasks::model::CreateGoalRequest;

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let goal = task_commands::create_goal(
        app.state(),
        CreateGoalRequest {
            title: "Goal".into(),
            parent_type: "domain".into(),
            parent_id: 1.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let info = infos::create_info(
        app.state(),
        CreateInfoRequest {
            body: "Note".into(),
            details: None,
            parent_type: "goal".into(),
            parent_id: goal.id.clone(),
            position: 0,
        },
    )
    .await
    .unwrap();
    let project = domains::create_domain(
        app.state(),
        CreateDomainRequest {
            title: "Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(1),
            status: None,
            knowledge_base_directory: None,
        },
    )
    .await
    .unwrap();
    let flow = flows::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Morning".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("day".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let item = flows::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Stretch".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();
    let nodes = vec![
        GestureNode {
            kind: "info".into(),
            id: info.id.into(),
        },
        GestureNode {
            kind: "goal".into(),
            id: goal.id.clone(),
        },
        GestureNode {
            kind: "flow_task".into(),
            id: item.id.into(),
        },
        GestureNode {
            kind: "flow".into(),
            id: flow.id.into(),
        },
        GestureNode {
            kind: "project".into(),
            id: project.id.into(),
        },
    ];

    node_gestures::delete_nodes(app.state(), nodes)
        .await
        .unwrap();

    let goal_id = goal.id.stored().expect("a stored goal");
    assert!(task_commands::get_goal(app.state(), goal_id).await.is_err());
    assert!(flows::get_flow(app.state(), flow.id).await.is_err());
    assert!(domains::get_domain(app.state(), project.id).await.is_err());
}

#[tokio::test]
async fn a_kind_that_is_not_deletable_or_not_stored_is_refused() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);

    let unknown = node_gestures::delete_nodes(
        app.state(),
        vec![GestureNode {
            kind: "habit_group".into(),
            id: 1.into(),
        }],
    )
    .await;
    let derived_flow = node_gestures::delete_nodes(
        app.state(),
        vec![GestureNode {
            kind: "flow".into(),
            id: serde_json::from_value(serde_json::json!("00000000-0000-5000-8000-000000000000"))
                .expect("a derived id"),
        }],
    )
    .await;
    let bad_item = node_gestures::delete_nodes(
        app.state(),
        vec![GestureNode {
            kind: "aspect".into(),
            id: 1.into(),
        }],
    )
    .await;

    assert!(unknown.is_err());
    assert!(derived_flow.is_err());
    assert!(bad_item.is_err());
}
