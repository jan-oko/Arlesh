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

use crate::helpers;

use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::flows::{
    self,
    model::{
        ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowId,
        FlowItemType, InstanceType, SetRecurrenceRequest, StartFlowRequest, TargetRef,
        UpdateFlowItemRequest, UpdateFlowRequest,
    },
};
use arlesh_lib::infos::model::CreateInfoRequest;
use arlesh_lib::scopes::model::ScopeKind;
use arlesh_lib::tasks::{
    add_task_dependency, create_goal, create_task,
    model::{CreateGoalRequest, CreateTaskRequest, Dependency, GoalId, TaskId, TimeScope},
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

/// Counts the block reasons hanging off one polymorphic owner.
///
/// `owner_id` alone is not a key — a goal and a task can share an id — so both halves of the link
/// are bound, which [`count_where`] cannot express with its single placeholder.
async fn count_block_reasons(pool: &sqlx::SqlitePool, owner_type: &str, owner_id: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM block_reasons WHERE owner_type = ? AND owner_id = ?")
        .bind(owner_type)
        .bind(owner_id)
        .fetch_one(pool)
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
    let start = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .scopes()
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
async fn the_set_habit_iteration_done_command_commits_a_modification_for_every_instance() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Routine")).await.unwrap();
    flow_commands::create_flow_task(
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
    let iteration = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .scopes()
        .get_or_create(ScopeKind::Week, ymd(2026, 1, 5))
        .await
        .unwrap()
        .id;

    flow_commands::set_habit_iteration_done(app.state(), flow.id, iteration, true, 1_767_600_000_000)
        .await
        .unwrap();

    assert_eq!(
        count_where(&pool, "habit_instance_modifications", "flow_id", flow.id).await,
        2,
        "the root instance and the one item — an iteration resolves as a unit or not at all"
    );
}

#[tokio::test]
async fn the_generate_habit_iterations_command_commits_the_scopes_it_materialises() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Routine")).await.unwrap();
    let start = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .scopes()
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
async fn the_duplicate_flow_command_commits_the_copy_and_its_recurrence() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Morning")).await.unwrap();
    let item = flow_commands::create_flow_task(
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
    flow_commands::set_flow_item_cycles(
        app.state(),
        flow.id,
        FlowItemType::FlowTask,
        item.id,
        vec![FlowCycleInput { scope_kind: Some("day".into()), scope_index: Some(1), ..Default::default() }],
    )
    .await
    .unwrap();
    let start = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .scopes()
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

    let copy = flow_commands::duplicate_flow(app.state(), flow.id, "aspect".into(), 2, 4)
        .await
        .unwrap();

    assert_ne!(copy.id, flow.id);
    assert_eq!(count_where(&pool, "flows", "id", copy.id).await, 1, "the copy's flow row");
    assert_eq!(count_where(&pool, "flow_tasks", "flow_id", copy.id).await, 1, "its item");
    assert_eq!(count_where(&pool, "flow_item_cycles", "flow_id", copy.id).await, 1, "its cycle pair");
    assert_eq!(
        count_where(&pool, "flow_recurrences", "flow_id", copy.id).await,
        1,
        "and the Recurrence that makes it a Habit — all in one transaction",
    );
}

#[tokio::test]
async fn the_duplicate_flow_item_command_commits_the_copied_item_and_its_pairs() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), create_req("Routine")).await.unwrap();
    let item = flow_commands::create_flow_task(
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
    flow_commands::set_flow_item_cycles(
        app.state(),
        flow.id,
        FlowItemType::FlowTask,
        item.id,
        vec![FlowCycleInput { scope_kind: Some("day".into()), scope_index: Some(3), ..Default::default() }],
    )
    .await
    .unwrap();

    let new_id = flow_commands::duplicate_flow_item(
        app.state(),
        FlowItemType::FlowTask,
        item.id,
        "flow".into(),
        flow.id,
        1,
    )
    .await
    .unwrap();

    assert_ne!(new_id, item.id);
    assert_eq!(count_where(&pool, "flow_tasks", "flow_id", flow.id).await, 2, "the original and its copy");
    assert_eq!(
        count_where(&pool, "flow_item_cycles", "item_id", new_id).await,
        1,
        "and the copy's own cycle pair — committed, not rolled back",
    );
}

#[tokio::test]
async fn the_convert_to_flow_command_commits_the_template_and_the_deletion() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let scope = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .scopes()
        .get_or_create(ScopeKind::Week, ymd(2026, 1, 5))
        .await
        .unwrap();
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let root = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Routine".into(),
            parent_type: "domain".into(),
            parent_id: 1,
            time_scope: Some(TimeScope { start_id: scope.id, end_id: scope.id, duration: None }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let step = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Step".into(),
            parent_type: "goal".into(),
            parent_id: root.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

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

/// Every row `convert_to_flow`'s subtree delete has to reach, by id.
///
/// Held by id rather than re-derived from a predicate: a "descendants of the root" query stops
/// matching the moment the root is deleted, so an assertion written that way silently shrinks to
/// checking the root alone.
struct ConvertSubtree {
    /// The goal the conversion is rooted at, scoped to a week so the flow gets a Span window.
    root_id: i64,
    /// A task child of the root, scoped to a day inside that week so a cycle pair is mapped.
    child_id: i64,
    /// A task child of `child_id` — a second level, so the cascade has to recurse.
    grandchild_id: i64,
    /// An info attached to the root.
    outer_info_id: i64,
    /// An info attached to `outer_info_id`, not to the root — the nesting the old raw delete loop
    /// never reached.
    nested_info_id: i64,
}

/// Seeds the subtree both cascade tests convert, and commits it.
///
/// Built through the session API rather than through a command because it is fixture data, not the
/// behaviour under test: one transaction, committed, so the pool is quiet before the test begins.
async fn seed_convert_subtree(pool: &sqlx::SqlitePool) -> ConvertSubtree {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();

    let week = db.scopes().get_or_create(ScopeKind::Week, ymd(2026, 1, 5)).await.unwrap();
    let day = db.scopes().get_or_create(ScopeKind::Day, ymd(2026, 1, 7)).await.unwrap();

    let root = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Routine".into(),
            parent_type: "domain".into(),
            parent_id: 1,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let child = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Step".into(),
            parent_type: "goal".into(),
            parent_id: root.id,
            time_scope: Some(TimeScope { start_id: day.id, end_id: day.id, duration: None }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let grandchild = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Sub-step".into(),
            parent_type: "task".into(),
            parent_id: child.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // A dependency inside the subtree, so the conversion writes a flow_dependencies row too.
    add_task_dependency(&mut db, TaskId(child.id), Dependency::Task { id: grandchild.id })
        .await
        .unwrap();

    // Block reasons and infos hang off polymorphic owner links with no foreign key, so nothing in
    // the schema removes them when their owner goes: the cascade has to do it by hand.
    db.block_reasons().set("goal", root.id, &["waiting on review".into()]).await.unwrap();
    db.block_reasons().set("task", child.id, &["blocked".into()]).await.unwrap();
    let outer = db
        .infos()
        .create(CreateInfoRequest {
            body: "outer note".into(),
            details: None,
            parent_type: "goal".into(),
            parent_id: root.id,
            position: 0,
        })
        .await
        .unwrap();
    let nested = db
        .infos()
        .create(CreateInfoRequest {
            body: "nested note".into(),
            details: None,
            parent_type: "info".into(),
            parent_id: outer.id,
            position: 0,
        })
        .await
        .unwrap();

    db.commit().await.unwrap();

    ConvertSubtree {
        root_id: root.id,
        child_id: child.id,
        grandchild_id: grandchild.id,
        outer_info_id: outer.id,
        nested_info_id: nested.id,
    }
}

#[tokio::test]
async fn the_convert_to_flow_command_commits_the_whole_cascade_under_the_deleted_subtree() {
    let pool = helpers::test_pool().await;
    let seeded = seed_convert_subtree(&pool).await;
    let app = helpers::command_host(&pool);

    flow_commands::convert_to_flow(app.state(), "goal".into(), seeded.root_id, true, true)
        .await
        .unwrap();

    assert_eq!(count_where(&pool, "goals", "id", seeded.root_id).await, 0, "the root goal");
    assert_eq!(count_where(&pool, "tasks", "id", seeded.child_id).await, 0, "its child task");
    assert_eq!(
        count_where(&pool, "tasks", "id", seeded.grandchild_id).await,
        0,
        "its grandchild task"
    );
    assert_eq!(
        count_block_reasons(&pool, "goal", seeded.root_id).await,
        0,
        "the root's block reason — no foreign key takes it, so the cascade must"
    );
    assert_eq!(
        count_block_reasons(&pool, "task", seeded.child_id).await,
        0,
        "and the child's"
    );
    assert_eq!(
        count_where(&pool, "infos", "id", seeded.outer_info_id).await,
        0,
        "the info attached to the root"
    );
    assert_eq!(
        count_where(&pool, "infos", "id", seeded.nested_info_id).await,
        0,
        "and the one nested under that info, which the old delete loop left behind"
    );
}

#[tokio::test]
async fn a_convert_to_flow_aborted_after_the_delete_restores_the_subtree_and_leaves_no_template() {
    let pool = helpers::test_pool().await;
    let seeded = seed_convert_subtree(&pool).await;

    // A second, unconvertible subtree: a task parented under a task, which `convert_to_flow`
    // rejects outright ("a flow cannot be parented under a task"). It is the failure this test
    // injects — see the comment at the injection point.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let blocker_parent = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Parent".into(),
            parent_type: "domain".into(),
            parent_id: 1,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let unconvertible = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Child".into(),
            parent_type: "task".into(),
            parent_id: blocker_parent.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    // The command's own shape: begin, convert, (…), commit. This test stands in for the caller and
    // fails where the command's `?` would fire.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let flow = flows::convert_to_flow(&mut db, "goal", seeded.root_id, true, true).await.unwrap();

    // The conversion really did get past its delete — otherwise the rollback assertions below
    // would hold vacuously.
    assert!(db.goals().get(GoalId(seeded.root_id)).await.is_err(), "deleted inside the transaction");
    assert_eq!(
        db.flows().list_tasks(FlowId(flow.id)).await.unwrap().len(),
        2,
        "and really did build the template first"
    );

    // The injected failure: a second conversion in the same transaction, rejected by the
    // operation's own guard on real input. Any error raised after `convert_to_flow` returns
    // reaches the database the same way — the `Db<Transactional>` is dropped without `commit()`
    // and sqlx rolls back — so this stands for the whole class, the failing `commit()` included.
    let rejected = flows::convert_to_flow(&mut db, "task", unconvertible.id, true, true).await;
    assert!(rejected.is_err(), "a task under a task cannot become a flow");
    drop(db);

    // Everything the conversion deleted is back, by id.
    assert_eq!(count_where(&pool, "goals", "id", seeded.root_id).await, 1, "the root goal");
    assert_eq!(count_where(&pool, "tasks", "id", seeded.child_id).await, 1, "its child task");
    assert_eq!(
        count_where(&pool, "tasks", "id", seeded.grandchild_id).await,
        1,
        "its grandchild task"
    );
    assert_eq!(
        count_block_reasons(&pool, "goal", seeded.root_id).await,
        1,
        "the root's block reason — the cascade widened in Task 2.2, so the rollback must undo it"
    );
    assert_eq!(count_block_reasons(&pool, "task", seeded.child_id).await, 1, "and the child's");
    assert_eq!(
        count_where(&pool, "infos", "id", seeded.outer_info_id).await,
        1,
        "the info attached to the root"
    );
    assert_eq!(
        count_where(&pool, "infos", "id", seeded.nested_info_id).await,
        1,
        "and the one nested under that info"
    );

    // And nothing of the abandoned template survives.
    assert_eq!(count_where(&pool, "flows", "id", flow.id).await, 0, "the template's flow row");
    assert_eq!(count_where(&pool, "flow_goals", "flow_id", flow.id).await, 0, "its goal items");
    assert_eq!(count_where(&pool, "flow_tasks", "flow_id", flow.id).await, 0, "its task items");
    assert_eq!(count_where(&pool, "flow_item_cycles", "flow_id", flow.id).await, 0, "its cycles");
    assert_eq!(
        count_where(&pool, "flow_dependencies", "flow_id", flow.id).await,
        0,
        "its remapped dependencies"
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

#[tokio::test]
async fn starting_a_commitment_flow_holding_a_goal_item_is_refused_outright() {
    // A Commitment holds Tasks and other Commitments, never a Goal — `goals.parent_type` says so.
    // A commitment flow whose template carries a goal item therefore has no materialisation, and
    // the refusal is the point: it fails loudly rather than dropping the item and building the
    // rest, which would quietly give the user a subtree that is not the template they wrote.
    //
    // Both ways of *reaching* this state are now shut — `create_flow_goal` refuses a commitment
    // flow, and `update_flow` refuses the instance-type switch over goal items (tests/flows.rs) —
    // so the fixture is built by writing the flows row directly, which is the only way it can
    // still arise: a board that was already in it. This test is the backstop behind those two
    // doors, not a duplicate of them.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest { instance_type: Some(InstanceType::Task), ..create_req("Asleep by 23:00") },
    )
    .await
    .unwrap();
    flow_commands::create_flow_goal(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Milestone".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE flows SET instance_type = 'commitment' WHERE id = ?")
        .bind(flow.id)
        .execute(&pool)
        .await
        .unwrap();

    let refused = flow_commands::start_flow(
        app.state(),
        flow.id,
        StartFlowRequest {
            title: "Tonight".into(),
            target_type: "aspect".into(),
            target_id: 1,
            anchor_date: ymd(2026, 1, 5),
        },
    )
    .await;

    assert!(refused.is_err(), "a Commitment cannot parent a Goal, so the run cannot stand");
    // And nothing half-built survives it: the root commitment is written before the goal is
    // attempted, so only a rolled-back transaction leaves the board as it was.
    assert_eq!(count_all(&pool, "commitments").await, 0, "not even the root commitment");
    assert_eq!(count_all(&pool, "goals").await, 0, "nor the goal that was refused");
    assert_eq!(count_all(&pool, "flow_instances").await, 0, "and no run was recorded");
}
