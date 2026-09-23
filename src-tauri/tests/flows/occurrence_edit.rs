//! One Habit occurrence edited on its own: its title, its block reason, its dependencies in that
//! iteration, and archiving it — an item's occurrence, and the iteration root.
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

fn root(habit: &Dinner, day: i64) -> HabitInstanceRef {
    HabitInstanceRef {
        item_type: "flow_root".into(),
        item_id: habit.flow_id,
        iteration_scope_id: day,
        cycle_id: 0,
    }
}

/// The iteration anchored at `day`.
fn iteration_on(iterations: &[HabitIteration], day: i64) -> HabitIteration {
    iterations
        .iter()
        .find(|iteration| iteration.anchor_scope_id == day)
        .cloned()
        .unwrap_or_else(|| panic!("no iteration anchored at {day}"))
}

async fn archive(app: &App, flow_id: i64, instance: HabitInstanceRef, archived: bool) {
    flow_commands::set_habit_instance_archived(app.state(), flow_id, instance, archived)
        .await
        .unwrap();
}

async fn mark_done(app: &App, flow_id: i64, instance: HabitInstanceRef) {
    flow_commands::set_habit_item_status(
        app.state(),
        flow_id,
        instance,
        Some("done".into()),
        1_767_600_000_000,
        Some(true),
    )
    .await
    .unwrap();
}

fn status_of(iteration: &HabitIteration) -> serde_json::Value {
    serde_json::to_value(iteration.status).unwrap()
}

#[tokio::test]
async fn an_archived_occurrence_is_marked_and_its_iteration_resolves_without_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;

    archive(
        &app,
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        true,
    )
    .await;
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
    assert!(shop.archived, "closing the iteration does not unarchive it");
    assert_eq!(
        status_of(&iteration_on(&drawn, habit.monday)),
        serde_json::json!("done"),
        "the iteration resolves once everything still in play is done"
    );
    assert!(!find(&drawn, habit.tuesday, habit.shop).archived);
    assert_eq!(divergent_iterations(&app, habit.flow_id).await, 1);

    archive(
        &app,
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        false,
    )
    .await;
    assert!(
        !find(
            &iterations(&app, habit.flow_id).await,
            habit.monday,
            habit.shop
        )
        .archived
    );
}

#[tokio::test]
async fn archiving_an_occurrence_sets_the_steps_nested_under_it_aside_too() {
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

    // Shop is archived; nothing is written to the list-writing step nested under it.
    archive(
        &app,
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        true,
    )
    .await;
    mark_done(&app, habit.flow_id, root(&habit, habit.monday)).await;
    mark_done(&app, habit.flow_id, occurrence(habit.cook, habit.monday)).await;

    assert_eq!(
        status_of(&iteration_on(
            &iterations(&app, habit.flow_id).await,
            habit.monday
        )),
        serde_json::json!("done"),
        "the nested step went aside with the occurrence it hangs under"
    );
}

#[tokio::test]
async fn an_occurrence_holding_an_added_child_is_archived_rather_than_refused() {
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

    archive(
        &app,
        habit.flow_id,
        occurrence(habit.shop, habit.monday),
        true,
    )
    .await;

    assert!(
        find(
            &iterations(&app, habit.flow_id).await,
            habit.monday,
            habit.shop
        )
        .archived
    );
}

#[tokio::test]
async fn the_iteration_root_takes_a_title_and_a_block_reason_of_its_own() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;

    flow_commands::set_habit_instance_title(
        app.state(),
        habit.flow_id,
        root(&habit, habit.monday),
        Some("Monday: dinner for six".into()),
    )
    .await
    .unwrap();
    flow_commands::set_habit_instance_block_reason(
        app.state(),
        habit.flow_id,
        root(&habit, habit.monday),
        Some("guests not confirmed".into()),
    )
    .await
    .unwrap();

    let drawn = iterations(&app, habit.flow_id).await;
    let monday = iteration_on(&drawn, habit.monday).root.unwrap();
    assert_eq!(monday.title.as_deref(), Some("Monday: dinner for six"));
    assert_eq!(
        monday.blocked_reason.as_deref(),
        Some("guests not confirmed")
    );
    assert_eq!(
        iteration_on(&drawn, habit.tuesday).root.unwrap().title,
        None,
        "tomorrow's iteration reads its own derived title"
    );
    assert_eq!(divergent_iterations(&app, habit.flow_id).await, 1);
}

#[tokio::test]
async fn archiving_the_iteration_root_sets_the_whole_iteration_aside_without_recording_it_done() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;

    archive(&app, habit.flow_id, root(&habit, habit.monday), true).await;

    let drawn = iterations(&app, habit.flow_id).await;
    let monday = iteration_on(&drawn, habit.monday);
    assert!(monday.root.as_ref().unwrap().archived);
    assert_eq!(
        status_of(&monday),
        serde_json::json!("done"),
        "an archived iteration no longer withholds the Habit"
    );
    let statuses = flow_commands::list_habit_item_statuses(app.state(), habit.flow_id)
        .await
        .unwrap();
    assert!(
        statuses.is_empty(),
        "nothing in it was recorded as done: archiving is not completing"
    );
}

#[tokio::test]
async fn the_iteration_root_is_planned_against_the_flows_root_cycle_plan() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;
    flow_commands::update_flow(
        app.state(),
        habit.flow_id,
        arlesh_lib::flows::model::UpdateFlowRequest {
            root_plan_kind: Some(Some("part_of_day".into())),
            root_plan_start: Some(Some(5)),
            root_plan_end: Some(Some(5)),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let drawn = iterations(&app, habit.flow_id).await;
    let monday = iteration_on(&drawn, habit.monday).root.unwrap();
    assert!(
        monday.cycle_plan.is_some(),
        "the root's Cycle Plan is drawn"
    );
    assert_eq!(monday.plan, monday.cycle_plan);

    flow_commands::set_habit_instance_plan(
        app.state(),
        habit.flow_id,
        root(&habit, habit.monday),
        arlesh_lib::flows::model::PlanOverride::Unplanned,
    )
    .await
    .unwrap();
    let drawn = iterations(&app, habit.flow_id).await;
    let monday = iteration_on(&drawn, habit.monday).root.unwrap();
    assert_eq!(monday.plan, None);
    assert!(monday.plan_overridden);
    assert!(
        iteration_on(&drawn, habit.tuesday)
            .root
            .unwrap()
            .cycle_plan
            .is_some(),
        "and the next iteration keeps its Cycle Plan"
    );

    let tuesday = day_scope(&pool, ymd(2026, 1, 6)).await;
    let refused = flow_commands::set_habit_instance_plan(
        app.state(),
        habit.flow_id,
        root(&habit, habit.monday),
        arlesh_lib::flows::model::PlanOverride::Planned {
            plan: arlesh_lib::tasks::model::TimeScope {
                start_id: tuesday,
                end_id: tuesday,
                duration: None,
            },
        },
    )
    .await
    .expect_err("Tuesday is outside Monday's iteration");
    assert_eq!(kind(refused).as_deref(), Some("containment_violated"));
}

#[tokio::test]
async fn the_iteration_root_takes_no_part_in_the_dependency_graph() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = dinner(&pool, &app).await;

    let refused = flow_commands::set_habit_instance_dependencies(
        app.state(),
        habit.flow_id,
        root(&habit, habit.monday),
        vec![task_ref(habit.shop)],
    )
    .await
    .expect_err("an iteration root waits on nothing");
    assert_eq!(kind(refused).as_deref(), Some("invalid_request"));
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
