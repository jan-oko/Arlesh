//! One Habit occurrence edited on its own: its title, its block reason, its dependencies in that
//! iteration, and deleting it from that iteration alone.
//!
//! Every test asks what an occurrence *ends up as* — through the derivation the Mindmap and the
//! MCP snapshot read — whether a write is refused, or whether the Habit counts as divergent. The
//! commands are called for real, so a lost `commit()` shows up as an edit that did not stick.

use crate::helpers;

use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::flows::model::{
    BlockingMode, ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, FlowItemRef,
    FlowItemType, HabitInstance, HabitInstanceRef, HabitIteration, InstanceType,
    SetRecurrenceRequest,
};
use arlesh_lib::scopes::model::ScopeKind;
use tauri::Manager;

type App = tauri::App<tauri::test::MockRuntime>;

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn at(y: i32, m: u32, d: u32) -> chrono::NaiveDateTime {
    ymd(y, m, d).and_hms_opt(9, 0, 0).unwrap()
}

async fn day_scope(pool: &sqlx::SqlitePool, date: chrono::NaiveDate) -> i64 {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .scopes()
        .get_or_create(ScopeKind::Day, date)
        .await
        .unwrap()
        .id
}

/// A daily, Overlapping Habit starting 2026-01-05 with two task items — "Shop", then "Cook", which
/// waits on it in the template — and the anchors of its first two days.
struct Dinner {
    flow_id: i64,
    shop: i64,
    cook: i64,
    monday: i64,
    tuesday: i64,
}

async fn dinner(pool: &sqlx::SqlitePool, app: &App) -> Dinner {
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Dinner".into(),
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
    let item = |title: &str| CreateFlowItemRequest {
        flow_id: flow.id,
        title: title.into(),
        parent_type: "flow".into(),
        parent_id: flow.id,
    };
    let shop = flow_commands::create_flow_task(app.state(), item("Shop"))
        .await
        .unwrap()
        .id;
    let cook = flow_commands::create_flow_task(app.state(), item("Cook"))
        .await
        .unwrap()
        .id;
    flow_commands::add_flow_dependency(
        app.state(),
        flow.id,
        FlowItemType::FlowTask,
        cook,
        FlowItemType::FlowTask,
        shop,
    )
    .await
    .unwrap();
    let monday = day_scope(pool, ymd(2026, 1, 5)).await;
    let tuesday = day_scope(pool, ymd(2026, 1, 6)).await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: monday,
            gap_n: None,
            gap_kind: None,
            end_scope_id: None,
            consumption_kind: ConsumptionKind::Accumulating,
            blocking_mode: Some(BlockingMode::Overlapping),
            catchup_policy: None,
        },
    )
    .await
    .unwrap();
    Dinner {
        flow_id: flow.id,
        shop,
        cook,
        monday,
        tuesday,
    }
}

fn task_ref(id: i64) -> FlowItemRef {
    FlowItemRef {
        item_type: "flow_task".into(),
        item_id: id,
    }
}

fn occurrence(item_id: i64, day: i64) -> HabitInstanceRef {
    HabitInstanceRef {
        item_type: "flow_task".into(),
        item_id,
        iteration_scope_id: day,
        cycle_id: 0,
    }
}

async fn iterations(app: &App, flow_id: i64) -> Vec<HabitIteration> {
    flow_commands::generate_habit_iterations(app.state(), flow_id, at(2026, 1, 6))
        .await
        .unwrap()
}

/// The occurrence of `item_id` in the iteration anchored at `day`.
fn find(iterations: &[HabitIteration], day: i64, item_id: i64) -> HabitInstance {
    iterations
        .iter()
        .find(|iteration| iteration.anchor_scope_id == day)
        .and_then(|iteration| {
            iteration
                .instances
                .iter()
                .find(|instance| instance.item_id == item_id)
        })
        .cloned()
        .unwrap_or_else(|| panic!("no occurrence of {item_id} on {day}"))
}

async fn divergent_iterations(app: &App, flow_id: i64) -> i64 {
    flow_commands::habit_completion_count(app.state(), flow_id)
        .await
        .unwrap()
}

fn kind(error: arlesh_lib::error::WireError) -> Option<String> {
    serde_json::to_value(&error).unwrap()["kind"]
        .as_str()
        .map(str::to_string)
}

#[tokio::test]
async fn an_occurrence_takes_a_title_of_its_own_and_gives_it_back() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;

    flow_commands::set_habit_instance_title(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        Some(" Shop at the market ".into()),
    )
    .await
    .unwrap();

    let drawn = iterations(&app, habit.flow_id).await;
    assert_eq!(
        find(&drawn, habit.monday, habit.shop).title.as_deref(),
        Some("Shop at the market")
    );
    assert_eq!(
        find(&drawn, habit.tuesday, habit.shop).title,
        None,
        "tomorrow reads the template's title"
    );
    assert_eq!(divergent_iterations(&app, habit.flow_id).await, 1);

    // Typing the template's own title back is handing it back.
    flow_commands::set_habit_instance_title(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        Some("Shop".into()),
    )
    .await
    .unwrap();
    assert_eq!(
        find(
            &iterations(&app, habit.flow_id).await,
            habit.monday,
            habit.shop
        )
        .title,
        None
    );
    assert_eq!(
        divergent_iterations(&app, habit.flow_id).await,
        0,
        "nothing differs any more, so nothing is stored"
    );
}

#[tokio::test]
async fn an_occurrence_takes_a_block_reason_and_clearing_it_leaves_nothing_behind() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;

    flow_commands::set_habit_instance_block_reason(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        Some("the market is shut".into()),
    )
    .await
    .unwrap();
    assert_eq!(
        find(
            &iterations(&app, habit.flow_id).await,
            habit.monday,
            habit.shop
        )
        .blocked_reason
        .as_deref(),
        Some("the market is shut")
    );

    flow_commands::set_habit_instance_block_reason(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        find(
            &iterations(&app, habit.flow_id).await,
            habit.monday,
            habit.shop
        )
        .blocked_reason,
        None
    );
    assert_eq!(divergent_iterations(&app, habit.flow_id).await, 0);
}

#[tokio::test]
async fn an_iteration_can_drop_a_template_dependency_and_the_next_one_keeps_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;
    assert_eq!(
        find(
            &iterations(&app, habit.flow_id).await,
            habit.monday,
            habit.cook
        )
        .depends_on,
        vec![task_ref(habit.shop)],
        "the template's edge holds in every iteration until one says otherwise"
    );

    flow_commands::set_habit_instance_dependencies(
        app.state(),
        habit.flow_id,
        occurrence(habit.cook, habit.monday),
        vec![],
    )
    .await
    .unwrap();

    let drawn = iterations(&app, habit.flow_id).await;
    assert!(find(&drawn, habit.monday, habit.cook).depends_on.is_empty());
    assert_eq!(
        find(&drawn, habit.tuesday, habit.cook).depends_on,
        vec![task_ref(habit.shop)]
    );
    assert_eq!(divergent_iterations(&app, habit.flow_id).await, 1);

    // Asking for the template's set again clears the divergence.
    flow_commands::set_habit_instance_dependencies(
        app.state(),
        habit.flow_id,
        occurrence(habit.cook, habit.monday),
        vec![task_ref(habit.shop)],
    )
    .await
    .unwrap();
    assert_eq!(divergent_iterations(&app, habit.flow_id).await, 0);
}

#[tokio::test]
async fn an_iteration_can_add_a_dependency_but_not_a_circular_one() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;

    let refused = flow_commands::set_habit_instance_dependencies(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        vec![task_ref(habit.cook)],
    )
    .await
    .expect_err("Cook already waits on Shop, so Shop cannot wait on Cook");
    assert_eq!(kind(refused).as_deref(), Some("invalid_request"));

    // Dropping the template edge first makes the reverse edge legal.
    flow_commands::set_habit_instance_dependencies(
        app.state(),
        habit.flow_id,
        occurrence(habit.cook, habit.monday),
        vec![],
    )
    .await
    .unwrap();
    flow_commands::set_habit_instance_dependencies(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        vec![task_ref(habit.cook)],
    )
    .await
    .unwrap();
    assert_eq!(
        find(
            &iterations(&app, habit.flow_id).await,
            habit.monday,
            habit.shop
        )
        .depends_on,
        vec![task_ref(habit.cook)]
    );
}

#[tokio::test]
async fn an_occurrence_does_not_wait_on_itself() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;

    let refused = flow_commands::set_habit_instance_dependencies(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        vec![task_ref(habit.shop)],
    )
    .await
    .expect_err("an item cannot wait on itself");
    assert_eq!(kind(refused).as_deref(), Some("invalid_request"));
}

#[tokio::test]
async fn a_deleted_occurrence_is_marked_and_no_longer_holds_its_iteration_open() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;

    flow_commands::set_habit_instance_deleted(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        true,
    )
    .await
    .unwrap();
    flow_commands::set_habit_iteration_done(
        app.state(),
        habit.flow_id,
        habit.monday,
        true,
        1_767_600_000_000,
        Some(true),
    )
    .await
    .unwrap();

    let drawn = iterations(&app, habit.flow_id).await;
    let shop = find(&drawn, habit.monday, habit.shop);
    assert!(shop.deleted, "closing the iteration does not bring it back");
    let monday = drawn
        .iter()
        .find(|iteration| iteration.anchor_scope_id == habit.monday)
        .unwrap();
    assert_eq!(
        serde_json::to_value(monday.status).unwrap(),
        serde_json::json!("done"),
        "the iteration resolves without the occurrence it no longer has"
    );
    assert!(!find(&drawn, habit.tuesday, habit.shop).deleted);
    assert_eq!(divergent_iterations(&app, habit.flow_id).await, 1);

    flow_commands::set_habit_instance_deleted(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        false,
    )
    .await
    .unwrap();
    assert!(
        !find(
            &iterations(&app, habit.flow_id).await,
            habit.monday,
            habit.shop
        )
        .deleted
    );
}

#[tokio::test]
async fn an_occurrence_holding_an_added_child_is_not_deleted() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;
    flow_commands::create_habit_instance_child(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        "task".into(),
        "buy milk".into(),
    )
    .await
    .unwrap();

    let refused = flow_commands::set_habit_instance_deleted(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        true,
    )
    .await
    .expect_err("it still holds the milk");
    assert_eq!(kind(refused).as_deref(), Some("invalid_request"));
}

#[tokio::test]
async fn an_occurrence_its_template_children_nest_under_is_not_deleted() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;
    flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: habit.flow_id,
            title: "Write the list".into(),
            parent_type: "flow_task".into(),
            parent_id: habit.shop,
        },
    )
    .await
    .unwrap();

    let refused = flow_commands::set_habit_instance_deleted(
        app.state(),
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        true,
    )
    .await
    .expect_err("the list-writing step hangs under this occurrence");
    assert_eq!(kind(refused).as_deref(), Some("invalid_request"));
}

#[tokio::test]
async fn the_iteration_root_is_not_edited_on_its_own() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;
    let root = HabitInstanceRef {
        item_type: "flow_root".into(),
        item_id: habit.flow_id,
        iteration_scope_id: habit.monday,
        cycle_id: 0,
    };

    let title = flow_commands::set_habit_instance_title(
        app.state(),
        habit.flow_id,
        root.clone(),
        Some("Monday dinner".into()),
    )
    .await
    .expect_err("the root's title is the iteration's");
    assert_eq!(kind(title).as_deref(), Some("invalid_request"));
    let deleted = flow_commands::set_habit_instance_deleted(app.state(), habit.flow_id, root, true)
        .await
        .expect_err("deleting the root would be deleting the iteration");
    assert_eq!(kind(deleted).as_deref(), Some("invalid_request"));
}

#[tokio::test]
async fn delete_and_regenerate_takes_the_dependency_divergences_with_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;
    flow_commands::set_habit_instance_dependencies(
        app.state(),
        habit.flow_id,
        occurrence(habit.cook, habit.monday),
        vec![],
    )
    .await
    .unwrap();

    flow_commands::clear_habit_modifications(app.state(), habit.flow_id)
        .await
        .unwrap();

    assert_eq!(divergent_iterations(&app, habit.flow_id).await, 0);
    assert_eq!(
        find(
            &iterations(&app, habit.flow_id).await,
            habit.monday,
            habit.cook
        )
        .depends_on,
        vec![task_ref(habit.shop)]
    );
}
