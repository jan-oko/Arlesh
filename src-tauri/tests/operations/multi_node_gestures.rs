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

// ---- Gesture operations made of listed writes ------------------------------------------------

/// Runs the gesture `name` from its writes as JSON, as the frontend sends them.
async fn gesture(
    app: &tauri::App<tauri::test::MockRuntime>,
    name: &str,
    steps: serde_json::Value,
) -> Result<Vec<serde_json::Value>, arlesh_lib::error::WireError> {
    node_gestures::run_gesture(
        app.state(),
        serde_json::from_value(serde_json::json!(name)).expect("a gesture name"),
        serde_json::from_value(steps).expect("gesture steps"),
    )
    .await
}

fn id_of(answer: &serde_json::Value) -> i64 {
    answer["id"].as_i64().expect("an id")
}

#[tokio::test]
async fn paste_copies_and_moves_each_kind_under_its_target() {
    use serde_json::json;
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let target = task(&app, "Target").await;
    let moved = task(&app, "Moved").await;
    let copied = task(&app, "Copied").await;
    let made = gesture(
        &app,
        "insert-parent",
        json!([
            { "op": "create_goal", "request": { "title": "Goal", "parent_type": "domain", "parent_id": 1 } },
            { "op": "create_info", "request": { "body": "Note", "parent_type": "domain", "parent_id": 1, "position": 0 } },
            { "op": "create_domain", "request": { "title": "Project", "description": null, "subtype": "project", "parent_id": 1, "status": null, "knowledge_base_directory": null } },
        ]),
    )
    .await
    .unwrap();
    let (goal, info, project) = (id_of(&made[0]), id_of(&made[1]), id_of(&made[2]));
    let target_id = target.id.stored().unwrap();

    let answers = gesture(
        &app,
        "paste",
        json!([
            { "op": "move", "kind": "task", "id": moved.id, "parent_kind": "task", "parent": target_id, "position": 0 },
            { "op": "duplicate", "kind": "task", "id": copied.id, "parent_kind": "task", "parent_id": target_id, "position": 1 },
            { "op": "duplicate", "kind": "goal", "id": goal, "parent_kind": "project", "parent_id": project, "position": 0 },
            { "op": "duplicate", "kind": "info", "id": info, "parent_kind": "task", "parent_id": target_id, "position": 2 },
            { "op": "duplicate", "kind": "project", "id": project, "parent_kind": "domain", "parent_id": 1, "position": 9 },
            { "op": "move", "kind": "goal", "id": goal, "parent_kind": "project", "parent": project, "position": 1 },
            { "op": "move", "kind": "info", "id": info, "parent_kind": "goal", "parent": goal, "position": 0 },
            { "op": "move", "kind": "project", "id": project, "parent_kind": "domain", "parent": 1, "position": 3 },
        ]),
    )
    .await
    .unwrap();

    assert_eq!(answers.len(), 8);
    let moved_task = task_commands::get_task(app.state(), moved.id.stored().unwrap())
        .await
        .unwrap();
    assert_eq!(moved_task.task.parent_id, target.id);
    assert_eq!(answers[1]["left_behind"], json!([]));
}

#[tokio::test]
async fn a_write_can_name_the_node_an_earlier_write_made() {
    use serde_json::json;
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let child = task(&app, "Child").await;

    let answers = gesture(
        &app,
        "insert-parent",
        json!([
            { "op": "create_task", "request": { "title": "Parent", "parent_type": "domain", "parent_id": 1 } },
            { "op": "move", "kind": "task", "id": child.id, "parent_kind": "task", "parent": { "step": 0 }, "position": 0 },
        ]),
    )
    .await
    .unwrap();

    let moved = task_commands::get_task(app.state(), child.id.stored().unwrap())
        .await
        .unwrap();
    assert_eq!(moved.task.parent_id, id_of(&answers[0]));
}

#[tokio::test]
async fn a_gesture_refuses_a_write_it_does_not_make_and_a_bad_reference() {
    use serde_json::json;
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let first = task(&app, "First").await;

    let stray = gesture(
        &app,
        "paste",
        json!([{ "op": "delete", "node": { "kind": "task", "id": first.id } }]),
    )
    .await;
    let dangling = gesture(
        &app,
        "save-task",
        json!([{ "op": "update_task", "id": { "step": 3 }, "request": { "title": "x" } }]),
    )
    .await;
    let not_made = gesture(
        &app,
        "save-task",
        json!([
            { "op": "set_block_reasons", "owner_type": "task", "id": first.id, "reasons": [] },
            { "op": "update_task", "id": { "step": 0 }, "request": { "title": "x" } },
        ]),
    )
    .await;

    assert!(stray.is_err());
    assert!(dangling.is_err());
    assert!(not_made.is_err());
    assert!(exists(&app, &first).await);
}

#[tokio::test]
async fn a_write_that_may_be_refused_is_taken_back_alone_and_the_rest_lands() {
    use serde_json::json;
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let kept = task(&app, "Kept").await;

    let answers = gesture(
        &app,
        "plan-tasks",
        json!([
            { "op": "update_task", "id": 99999, "request": { "title": "nobody" }, "may_be_refused": true },
            { "op": "update_task", "id": kept.id, "request": { "title": "Renamed" }, "may_be_refused": true },
        ]),
    )
    .await
    .unwrap();

    assert!(answers[0].get("refused").is_some());
    let renamed = task_commands::get_task(app.state(), kept.id.stored().unwrap())
        .await
        .unwrap();
    assert_eq!(renamed.task.title, "Renamed");
}

#[tokio::test]
async fn a_task_save_writes_the_task_and_what_hangs_on_it_together() {
    use serde_json::json;
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let saved = task(&app, "Saved").await;
    let prerequisite = task(&app, "Prerequisite").await;
    let made = gesture(
        &app,
        "save-project",
        json!([
            { "op": "create_domain", "request": { "title": "Tag", "description": null, "subtype": "tag", "parent_id": 1, "status": null, "knowledge_base_directory": null } },
            { "op": "update_domain", "id": { "step": 0 }, "request": { "title": "Renamed tag" } },
        ]),
    )
    .await
    .unwrap();
    let tag = id_of(&made[0]);

    gesture(
        &app,
        "save-task",
        json!([
            { "op": "update_task", "id": saved.id, "request": { "title": "Saved again", "status": { "kind": "ordinary", "status": "done" } } },
            { "op": "set_task_done_at", "id": saved.id, "at": "2026-09-26T19:00:00" },
            { "op": "set_block_reasons", "owner_type": "task", "id": saved.id, "reasons": ["Waiting"] },
            { "op": "set_tag", "kind": "task", "id": saved.id, "tag_id": tag, "present": true },
            { "op": "set_task_dependency", "task_id": saved.id, "dependency": { "type": "task", "id": prerequisite.id }, "present": true },
            { "op": "set_task_dependency", "task_id": saved.id, "dependency": { "type": "task", "id": prerequisite.id }, "present": false },
            { "op": "set_tag", "kind": "task", "id": saved.id, "tag_id": tag, "present": false },
        ]),
    )
    .await
    .unwrap();

    let read = task_commands::get_task(app.state(), saved.id.stored().unwrap())
        .await
        .unwrap();
    assert_eq!(read.task.title, "Saved again");
}

#[tokio::test]
async fn the_goal_wait_and_info_saves() {
    use serde_json::json;
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);

    let made = gesture(
        &app,
        "save-wait",
        json!([
            { "op": "create_goal", "request": { "title": "Goal", "parent_type": "domain", "parent_id": 1 } },
            { "op": "update_goal", "id": { "step": 0 }, "request": { "title": "Goal again" } },
        ]),
    )
    .await
    .unwrap();
    let goal = id_of(&made[0]);
    let wait = gesture(
        &app,
        "save-wait",
        json!([
            { "op": "create_expectation", "request": { "title": "Reply", "parent_type": "goal", "parent_id": goal } },
            { "op": "update_expectation", "id": { "step": 0 }, "request": { "is_private": true } },
            { "op": "create_info", "request": { "body": "Note", "parent_type": "goal", "parent_id": goal, "position": 0 } },
            { "op": "update_info", "id": { "step": 2 }, "request": { "body": "Note again" } },
        ]),
    )
    .await
    .unwrap();

    assert_eq!(wait.len(), 4);
}

#[tokio::test]
async fn a_new_habit_and_its_save_with_archive_and_new() {
    use serde_json::json;
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let made = gesture(
        &app,
        "new-flow",
        json!([
            { "op": "create_flow", "request": { "title": "Morning", "instance_type": "task", "parent_type": "aspect", "parent_id": 1, "flow_duration_n": 1, "flow_duration_kind": "day" } },
            { "op": "update_flow", "id": { "step": 0 }, "request": { "title": "Morning routine" } },
            { "op": "set_flow_recurrence", "flow_id": { "step": 0 }, "request": { "start_scope_id": { "kind": "day", "date": "2026-01-05" }, "gap_n": null, "gap_kind": null, "end_scope_id": null, "clock": "interval", "miss_policy": null } },
            { "op": "create_flow_item", "item_type": "flow_task", "request": { "flow_id": 0, "title": "placeholder", "parent_type": "flow", "parent_id": 0 }, "may_be_refused": true },
        ]),
    )
    .await
    .unwrap();
    let flow = id_of(&made[0]);
    let items = gesture(
        &app,
        "save-flow",
        json!([
            { "op": "create_flow_item", "item_type": "flow_task", "request": { "flow_id": flow, "title": "Stretch", "parent_type": "flow", "parent_id": flow } },
            { "op": "create_flow_item", "item_type": "flow_task", "request": { "flow_id": flow, "title": "Breathe", "parent_type": "flow", "parent_id": flow } },
        ]),
    )
    .await
    .unwrap();
    let (stretch, breathe) = (id_of(&items[0]), id_of(&items[1]));

    gesture(
        &app,
        "save-flow-item",
        json!([
            { "op": "set_flow_item_cycles", "flow_id": flow, "item_type": "flow_task", "item_id": stretch, "cycles": [] },
            { "op": "update_flow_item", "item_type": "flow_task", "id": { "step": 0, "forked": "flow_task", "id": stretch }, "request": { "title": "Stretch well" } },
            { "op": "set_flow_dependency", "flow_id": { "step": 0, "forked": "flow", "id": flow }, "dependent_type": "flow_task", "dependent_id": { "step": 0, "forked": "flow_task", "id": stretch }, "depends_on_type": "flow_task", "depends_on_id": breathe, "present": true },
            { "op": "set_flow_dependency", "flow_id": flow, "dependent_type": "flow_task", "dependent_id": stretch, "depends_on_type": "flow_task", "depends_on_id": breathe, "present": false },
        ]),
    )
    .await
    .unwrap();
    let forked = gesture(
        &app,
        "save-flow",
        json!([
            { "op": "clear_habit_modifications", "flow_id": flow },
            { "op": "fork_flow", "flow_id": flow },
            { "op": "update_flow", "id": { "step": 1 }, "request": { "title": "Morning, again" } },
            { "op": "delete_flow_recurrence", "flow_id": { "step": 1 } },
        ]),
    )
    .await
    .unwrap();

    assert_ne!(id_of(&forked[1]), flow);
}

/// Every write the gesture operations can make, each against a kind it is made for. The writes
/// whose outcome is not this test's point may be refused, so one refusal cannot hide the rest.
#[tokio::test]
async fn every_write_a_gesture_makes_runs_against_its_kind() {
    use serde_json::json;
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let holder = task(&app, "Holder").await;
    let day = json!({ "start_id": { "kind": "day", "date": "2026-06-10" }, "end_id": { "kind": "day", "date": "2026-06-10" } });
    let made = gesture(
        &app,
        "save-commitment",
        json!([
            { "op": "create_commitment", "request": { "title": "Rule", "parent_type": "domain", "parent_id": 1, "time_scope": day }, "may_be_refused": true },
            { "op": "update_commitment", "id": { "step": 0 }, "request": { "title": "Rule again" }, "may_be_refused": true },
            { "op": "create_expectation", "request": { "title": "Reply", "parent_type": "task", "parent_id": holder.id } },
            { "op": "create_flow", "request": { "title": "Plan", "instance_type": "goal", "parent_type": "aspect", "parent_id": 1, "flow_duration_n": 1, "flow_duration_kind": "week" } },
        ]),
    )
    .await
    .unwrap();
    let (wait, flow) = (id_of(&made[2]), id_of(&made[3]));
    let items = gesture(
        &app,
        "new-flow",
        json!([
            { "op": "create_flow_item", "item_type": "flow_goal", "request": { "flow_id": flow, "title": "Goal item", "parent_type": "flow", "parent_id": flow } },
            { "op": "create_flow_item", "item_type": "flow_commitment", "request": { "flow_id": flow, "title": "Rule item", "parent_type": "flow", "parent_id": flow }, "may_be_refused": true },
            { "op": "create_flow_item", "item_type": "flow_expectation", "request": { "flow_id": flow, "title": "Wait item", "parent_type": "flow", "parent_id": flow }, "may_be_refused": true },
            { "op": "update_flow_item", "item_type": "flow_goal", "id": { "step": 0 }, "request": { "title": "Goal item again" } },
            { "op": "update_flow_item", "item_type": "flow_commitment", "id": { "step": 1 }, "request": { "title": "Rule item again" }, "may_be_refused": true },
            { "op": "update_flow_item", "item_type": "flow_expectation", "id": { "step": 2 }, "request": { "title": "Wait item again" }, "may_be_refused": true },
            { "op": "update_spawned_wait", "task_id": holder.id, "request": { "title": "Spawned" }, "may_be_refused": true },
        ]),
    )
    .await
    .unwrap();
    let goal_item = id_of(&items[0]);

    let answers = gesture(
        &app,
        "paste",
        json!([
            { "op": "move", "kind": "expectation", "id": wait, "parent_kind": "domain", "parent": 1, "position": 0, "may_be_refused": true },
            { "op": "move", "kind": "commitment", "id": { "step": 0 }, "parent_kind": "task", "parent": holder.id, "position": 0, "may_be_refused": true },
            { "op": "duplicate", "kind": "flow", "id": flow, "parent_kind": "aspect", "parent_id": 1, "position": 5 },
            { "op": "duplicate", "kind": "flow_goal", "id": goal_item, "parent_kind": "flow", "parent_id": flow, "position": 2 },
            { "op": "move", "kind": "flow_goal", "id": goal_item, "parent_kind": "flow", "parent": flow, "position": 3 },
            { "op": "move", "kind": "flow", "id": flow, "parent_kind": "domain", "parent": 1, "position": 6 },
            { "op": "move", "kind": "flow", "id": flow, "parent_kind": "task", "parent": holder.id, "position": 0, "may_be_refused": true },
            { "op": "move", "kind": "info", "id": 1, "parent_kind": "flow", "parent": flow, "position": 0, "may_be_refused": true },
            { "op": "move", "kind": "flow_task", "id": 1, "parent_kind": "task", "parent": holder.id, "position": 0, "may_be_refused": true },
            { "op": "move", "kind": "aspect", "id": 1, "parent_kind": "domain", "parent": 1, "position": 0, "may_be_refused": true },
            { "op": "duplicate", "kind": "commitment", "id": 1, "parent_kind": "task", "parent_id": 1, "position": 0, "may_be_refused": true },
            { "op": "duplicate", "kind": "flow_task", "id": 1, "parent_kind": "task", "parent_id": 1, "position": 0, "may_be_refused": true },
            { "op": "move", "kind": "task", "id": "00000000-0000-5000-8000-000000000000", "parent_kind": "info", "parent": 1, "position": 0, "may_be_refused": true },
        ]),
    )
    .await
    .unwrap();
    let derived = gesture(
        &app,
        "save-wait",
        json!([{ "op": "update_info", "id": "00000000-0000-5000-8000-000000000000", "request": { "body": "x" }, "may_be_refused": true }]),
    )
    .await
    .unwrap();

    assert_eq!(answers.len(), 13);
    assert!(
        derived[0].get("refused").is_some(),
        "an Info has no derived rows"
    );
    assert!(answers[9].get("refused").is_some(), "an Aspect never moves");
    assert!(
        answers[10].get("refused").is_some(),
        "a Commitment has no copy"
    );
}

#[tokio::test]
async fn archive_nodes_archives_each_node_and_admits_no_other_write() {
    use serde_json::json;
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let first = task(&app, "First").await;
    let second = task(&app, "Second").await;
    let archive = |task: &Task| json!({ "op": "update_task", "id": task.id, "request": { "archival": "archived" } });

    gesture(
        &app,
        "archive-nodes",
        json!([archive(&first), archive(&second)]),
    )
    .await
    .unwrap();
    let refused = gesture(
        &app,
        "archive-nodes",
        json!([{ "op": "delete", "node": { "kind": "task", "id": first.id } }]),
    )
    .await;

    for archived in [&first, &second] {
        let read = task_commands::get_task(app.state(), archived.id.stored().unwrap())
            .await
            .unwrap();
        assert_eq!(json!(read.task.archival), json!("archived"));
    }
    assert!(refused.is_err());
}
