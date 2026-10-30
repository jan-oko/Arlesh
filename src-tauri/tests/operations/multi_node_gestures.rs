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
