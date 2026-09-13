//! Command-level tests for every flow command that opens a transaction.
//!
//! A `begin()` command's `commit()` is not protected by the compiler: in a value-returning command
//! it is a `?` line in the middle of the body, and deleting it still compiles and rolls back
//! silently (sqlx rolls back a dropped transaction). Only a test that calls the real command and
//! then reads the rows back off the pool catches that — asserting `Ok` proves nothing, since a
//! rollback returns `Ok` too. See ADR-0004 and the Task 2.2 slice reports.
//!
//! The commands are reached through [`helpers::command_host`], which manages a `SessionFactory`
//! over the test pool so `app.state()` can hand a command its `State`. The pool has **one**
//! connection, so every assertion here reads it only after the command's session has closed.

mod helpers;

use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::flows::model::{
    ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowItemType,
    InstanceType, SetRecurrenceRequest, StartFlowRequest, TargetRef, UpdateFlowItemRequest,
    UpdateFlowRequest,
};
use arlesh_lib::scopes::{model::ScopeKind, ScopeRepository};
use arlesh_lib::tasks::{
    model::{CreateGoalRequest, CreateTaskRequest, TimeScope},
    GoalRepository, TaskRepository,
};
use tauri::Manager;

/// Counts the rows of `table` whose `column` equals `value`.
///
/// One placeholder, one bind: a helper that took a whole predicate would let a caller write more
/// `?`s than it binds, and sqlx fills the remainder with NULL instead of erroring.
async fn count_where(pool: &sqlx::SqlitePool, table: &str, column: &str, value: i64) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?"))
        .bind(value)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Reads one text column of a single row identified by its primary key.
async fn text_at(pool: &sqlx::SqlitePool, table: &str, column: &str, id: i64) -> Option<String> {
    sqlx::query_scalar(&format!("SELECT {column} FROM {table} WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await
        .unwrap()
}

/// Total rows in `table`.
async fn count_all(pool: &sqlx::SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_one(pool)
        .await
        .unwrap()
}

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

/// A two-week Span flow under the seeded aspect 1.
fn create_req(title: &str) -> CreateFlowRequest {
    CreateFlowRequest {
        title: title.into(),
        instance_type: Some(InstanceType::Task),
        parent_type: "aspect".into(),
        parent_id: 1,
        flow_duration_n: Some(2),
        flow_duration_kind: Some("week".into()),
        ..Default::default()
    }
}

#[tokio::test]
async fn the_update_flow_command_commits_the_merged_row() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Draft")).await.unwrap();

    flow_commands::update_flow(
        app.state(),
        flow.id,
        UpdateFlowRequest { title: Some("Renamed".into()), ..Default::default() },
    )
    .await
    .unwrap();

    assert_eq!(
        text_at(&pool, "flows", "title", flow.id).await.as_deref(),
        Some("Renamed"),
        "the command must commit the merged row"
    );
}

#[tokio::test]
async fn the_delete_flow_command_commits_the_deletion() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Doomed")).await.unwrap();

    flow_commands::delete_flow(app.state(), flow.id).await.unwrap();

    assert_eq!(count_where(&pool, "flows", "id", flow.id).await, 0);
}

#[tokio::test]
async fn the_update_flow_goal_command_commits_the_merged_row() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Feature")).await.unwrap();
    let goal = flow_commands::create_flow_goal(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Shipped".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();

    flow_commands::update_flow_goal(
        app.state(),
        goal.id,
        UpdateFlowItemRequest { title: Some("Released".into()), ..Default::default() },
    )
    .await
    .unwrap();

    assert_eq!(
        text_at(&pool, "flow_goals", "title", goal.id).await.as_deref(),
        Some("Released")
    );
}

#[tokio::test]
async fn the_update_flow_task_command_commits_the_merged_row() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Feature")).await.unwrap();
    let task = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Draft".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();

    flow_commands::update_flow_task(
        app.state(),
        task.id,
        UpdateFlowItemRequest { title: Some("Implement".into()), ..Default::default() },
    )
    .await
    .unwrap();

    assert_eq!(
        text_at(&pool, "flow_tasks", "title", task.id).await.as_deref(),
        Some("Implement")
    );
}

#[tokio::test]
async fn the_set_flow_item_cycles_command_commits_every_pair() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Routine")).await.unwrap();
    let task = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Exercise".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();

    flow_commands::set_flow_item_cycles(
        app.state(),
        flow.id,
        FlowItemType::FlowTask,
        task.id,
        vec![
            FlowCycleInput {
                scope_kind: Some("day".into()),
                scope_index: Some(1),
                ..Default::default()
            },
            FlowCycleInput {
                scope_kind: Some("day".into()),
                scope_index: Some(3),
                ..Default::default()
            },
        ],
    )
    .await
    .unwrap();

    assert_eq!(
        count_where(&pool, "flow_item_cycles", "item_id", task.id).await,
        2,
        "both inserts must land, not just the delete that preceded them"
    );
}

#[tokio::test]
async fn the_delete_flow_item_command_commits_the_item_and_its_links() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Feature")).await.unwrap();
    let specify = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Specify".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();
    let build = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Build".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();
    flow_commands::set_flow_item_cycles(
        app.state(),
        flow.id,
        FlowItemType::FlowTask,
        specify.id,
        vec![FlowCycleInput::default()],
    )
    .await
    .unwrap();
    flow_commands::add_flow_dependency(
        app.state(),
        flow.id,
        FlowItemType::FlowTask,
        build.id,
        FlowItemType::FlowTask,
        specify.id,
    )
    .await
    .unwrap();

    flow_commands::delete_flow_item(app.state(), FlowItemType::FlowTask, specify.id)
        .await
        .unwrap();

    assert_eq!(count_where(&pool, "flow_tasks", "id", specify.id).await, 0, "the row");
    assert_eq!(
        count_where(&pool, "flow_item_cycles", "item_id", specify.id).await,
        0,
        "its cycle pairs"
    );
    assert_eq!(
        count_where(&pool, "flow_dependencies", "depends_on_id", specify.id).await,
        0,
        "the edge that pointed at it"
    );
}

#[tokio::test]
async fn the_convert_flow_item_command_commits_both_halves() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Feature")).await.unwrap();
    let task = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Ambiguous".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();

    let new_id =
        flow_commands::convert_flow_item(app.state(), FlowItemType::FlowTask, task.id, FlowItemType::FlowGoal)
            .await
            .unwrap();

    assert_eq!(
        text_at(&pool, "flow_goals", "title", new_id).await.as_deref(),
        Some("Ambiguous"),
        "the new row must be committed"
    );
    assert_eq!(
        count_where(&pool, "flow_tasks", "id", task.id).await,
        0,
        "and the old one deleted in the same transaction"
    );
}

#[tokio::test]
async fn the_set_flow_recurrence_command_commits_the_recurrence() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Routine")).await.unwrap();
    let start = ScopeRepository::new(&pool)
        .get_or_create(ScopeKind::Week, ymd(2026, 1, 5))
        .await
        .unwrap()
        .id;

    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: start,
            gap_n: None,
            gap_kind: None,
            end_scope_id: None,
            consumption_kind: ConsumptionKind::Destructive,
            blocking_mode: None,
            catchup_policy: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(count_where(&pool, "flow_recurrences", "flow_id", flow.id).await, 1);
}

#[tokio::test]
async fn the_generate_habit_iterations_command_commits_the_scopes_it_materialises() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Routine")).await.unwrap();
    let start = ScopeRepository::new(&pool)
        .get_or_create(ScopeKind::Week, ymd(2026, 1, 5))
        .await
        .unwrap()
        .id;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: start,
            gap_n: None,
            gap_kind: None,
            end_scope_id: None,
            consumption_kind: ConsumptionKind::Destructive,
            blocking_mode: None,
            catchup_policy: None,
        },
    )
    .await
    .unwrap();
    let scopes_before = count_all(&pool, "scopes").await;

    // Three two-week windows have started by the 4th of February.
    let iterations = flow_commands::generate_habit_iterations(
        app.state(),
        flow.id,
        ymd(2026, 2, 4).and_hms_opt(9, 0, 0).unwrap(),
    )
    .await
    .unwrap();

    assert_eq!(iterations.len(), 3, "the derivation itself");
    assert!(
        count_all(&pool, "scopes").await > scopes_before,
        "the canonical scopes each window landed on must be committed, not rolled back"
    );
    for iteration in &iterations {
        assert_eq!(
            count_where(&pool, "scopes", "id", iteration.anchor_scope_id).await,
            1,
            "every iteration's anchoring scope must be on disk"
        );
    }
}

#[tokio::test]
async fn the_scope_valid_flow_targets_command_commits_the_window_it_resolves() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let scopes_before = count_all(&pool, "scopes").await;

    let valid = flow_commands::scope_valid_flow_targets(
        app.state(),
        Some(2),
        Some("week".into()),
        Some(ymd(2026, 1, 5)),
        vec![TargetRef { node_type: "aspect".into(), node_id: 1 }],
    )
    .await
    .unwrap();

    assert_eq!(valid.len(), 1, "an unscoped aspect constrains nothing");
    assert!(
        count_all(&pool, "scopes").await > scopes_before,
        "the window's canonical scopes must be committed, not rolled back"
    );
}

#[tokio::test]
async fn the_fork_flow_command_commits_the_whole_clone() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Routine")).await.unwrap();
    let parent = flow_commands::create_flow_goal(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Warm up".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();
    let child = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Stretch".into(),
            parent_type: "flow_goal".into(),
            parent_id: parent.id,
        },
    )
    .await
    .unwrap();
    flow_commands::set_flow_item_cycles(
        app.state(),
        flow.id,
        FlowItemType::FlowTask,
        child.id,
        vec![FlowCycleInput {
            scope_kind: Some("day".into()),
            scope_index: Some(1),
            ..Default::default()
        }],
    )
    .await
    .unwrap();

    let forked = flow_commands::fork_flow(app.state(), flow.id).await.unwrap();

    assert_ne!(forked.id, flow.id);
    assert_eq!(
        count_where(&pool, "flows", "id", forked.id).await,
        1,
        "the clone's flow row"
    );
    assert_eq!(count_where(&pool, "flow_goals", "flow_id", forked.id).await, 1, "its goal item");
    assert_eq!(count_where(&pool, "flow_tasks", "flow_id", forked.id).await, 1, "its task item");
    assert_eq!(
        count_where(&pool, "flow_item_cycles", "flow_id", forked.id).await,
        1,
        "and the cycle pair remapped onto it — all in one transaction"
    );
}

#[tokio::test]
async fn the_convert_to_flow_command_commits_the_template_and_the_deletion() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let scope = ScopeRepository::new(&pool)
        .get_or_create(ScopeKind::Week, ymd(2026, 1, 5))
        .await
        .unwrap();
    let root = GoalRepository::new(&pool)
        .create(CreateGoalRequest {
            title: "Routine".into(),
            parent_type: "domain".into(),
            parent_id: 1,
            time_scope: Some(TimeScope { start_id: scope.id, end_id: scope.id, duration: None }),
            ..Default::default()
        })
        .await
        .unwrap();
    let step = TaskRepository::new(&pool)
        .create(CreateTaskRequest {
            title: "Step".into(),
            parent_type: "goal".into(),
            parent_id: root.id,
            ..Default::default()
        })
        .await
        .unwrap();

    let flow = flow_commands::convert_to_flow(app.state(), "goal".into(), root.id, true, true)
        .await
        .unwrap();

    assert_eq!(count_where(&pool, "flows", "id", flow.id).await, 1, "the template's flow row");
    assert_eq!(
        count_where(&pool, "flow_tasks", "flow_id", flow.id).await,
        1,
        "the item mirroring the child"
    );
    assert_eq!(count_where(&pool, "goals", "id", root.id).await, 0, "the original root");
    assert_eq!(
        count_where(&pool, "tasks", "id", step.id).await,
        0,
        "and its descendant — the deletion and the inserts commit together or not at all"
    );
}

#[tokio::test]
async fn the_start_flow_command_commits_the_materialised_subtree() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Feature")).await.unwrap();
    flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Draft".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();

    let materialized = flow_commands::start_flow(
        app.state(),
        flow.id,
        StartFlowRequest {
            title: "Ship the feature".into(),
            target_type: "aspect".into(),
            target_id: 1,
            anchor_date: ymd(2026, 1, 5),
        },
    )
    .await
    .unwrap();

    assert_eq!(materialized.root_type, "task");
    assert_eq!(
        text_at(&pool, "tasks", "title", materialized.root_id).await.as_deref(),
        Some("Ship the feature"),
        "the materialised root must be committed"
    );
    assert_eq!(
        count_all(&pool, "tasks").await,
        2,
        "root plus the one item instance, both in the same transaction"
    );
    assert_eq!(count_where(&pool, "flow_instances", "flow_id", flow.id).await, 1, "the instance");
    assert_eq!(
        count_all(&pool, "flow_instance_nodes").await,
        2,
        "and one recorded node per materialised task"
    );
}
