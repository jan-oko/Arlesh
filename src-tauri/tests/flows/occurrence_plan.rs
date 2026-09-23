//! One Habit occurrence planned on its own, overriding the Cycle Plan for that iteration alone.
//!
//! Every test asks what Plan an occurrence *ends up with* — through the same derivation the
//! Mindmap and the MCP snapshot read — or whether a write is refused. None of them asserts which
//! column was written.

use crate::helpers;

use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::flows::model::{
    ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowItemType,
    HabitInstance, HabitInstanceRef, HabitIteration, InstanceType, PlanOverride,
    SetRecurrenceRequest,
};
use arlesh_lib::scopes::model::ScopeKind;
use arlesh_lib::tasks::model::TimeScope;
use tauri::Manager;

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn at(y: i32, m: u32, d: u32) -> chrono::NaiveDateTime {
    ymd(y, m, d).and_hms_opt(9, 0, 0).unwrap()
}

/// Mints the canonical scope a date falls in.
async fn scope_id(pool: &sqlx::SqlitePool, kind: ScopeKind, date: chrono::NaiveDate) -> i64 {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .scopes()
        .get_or_create(kind, date)
        .await
        .unwrap()
        .id
}

/// A single Day, as a Plan window.
async fn day(pool: &sqlx::SqlitePool, date: chrono::NaiveDate) -> TimeScope {
    let id = scope_id(pool, ScopeKind::Day, date).await;
    TimeScope {
        start_id: id,
        end_id: id,
        duration: None,
    }
}

/// A weekly Habit starting the week of Sunday 2026-01-04 (weeks run Sunday to Saturday) whose one task item — "Run" — has a single cycle
/// pair: `cycle_scope` as its Cycle Scope and the 2nd day of it as its Cycle Plan.
struct WeeklyRun {
    flow_id: i64,
    item_id: i64,
    cycle_id: i64,
    first_week: i64,
}

async fn weekly_run(
    pool: &sqlx::SqlitePool,
    app: &tauri::App<tauri::test::MockRuntime>,
    cycle_scope: &str,
) -> WeeklyRun {
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Fitness".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("week".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let item = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Run".into(),
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
        vec![cycle(cycle_scope, 2)],
        None,
        None,
    )
    .await
    .unwrap();
    let first_week = scope_id(pool, ScopeKind::Week, ymd(2026, 1, 5)).await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: first_week,
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
    let cycle_id: i64 = sqlx::query_scalar("SELECT id FROM flow_item_cycles WHERE item_id = ?")
        .bind(item.id)
        .fetch_one(pool)
        .await
        .unwrap();
    WeeklyRun {
        flow_id: flow.id,
        item_id: item.id,
        cycle_id,
        first_week,
    }
}

/// A cycle pair of kind `scope_kind`, planned on its `plan_index`-th subscope.
///
/// A `week` pair covers the whole iteration and plans its 2nd day; a `day` pair is the 2nd day of
/// the week and plans the 2nd part of that day.
fn cycle(scope_kind: &str, plan_index: i64) -> FlowCycleInput {
    let (scope_index, plan_kind) = if scope_kind == "week" {
        (1, "day")
    } else {
        (2, "part_of_day")
    };
    FlowCycleInput {
        scope_kind: Some(scope_kind.into()),
        scope_index: Some(scope_index),
        plan_kind: Some(plan_kind.into()),
        plan_start: Some(plan_index),
        plan_end: Some(plan_index),
    }
}

impl WeeklyRun {
    fn occurrence(&self, week: i64) -> HabitInstanceRef {
        HabitInstanceRef {
            item_type: "flow_task".into(),
            item_id: self.item_id,
            iteration_scope_id: week,
            cycle_id: self.cycle_id,
        }
    }
}

async fn iterations(
    app: &tauri::App<tauri::test::MockRuntime>,
    flow_id: i64,
    now: chrono::NaiveDateTime,
) -> Vec<HabitIteration> {
    flow_commands::generate_habit_iterations(app.state(), flow_id, now)
        .await
        .unwrap()
}

/// The Run occurrence of the iteration anchored at `week`.
fn run_in(iterations: &[HabitIteration], week: i64) -> HabitInstance {
    iterations
        .iter()
        .find(|iteration| iteration.anchor_scope_id == week)
        .and_then(|iteration| iteration.instances.first())
        .cloned()
        .unwrap_or_else(|| panic!("no Run occurrence in the iteration anchored at {week}"))
}

async fn set_plan(
    app: &tauri::App<tauri::test::MockRuntime>,
    flow_id: i64,
    instance: HabitInstanceRef,
    plan: PlanOverride,
) -> Result<(), serde_json::Value> {
    flow_commands::set_habit_instance_plan(app.state(), flow_id, instance, plan)
        .await
        .map_err(|error| serde_json::to_value(&error).unwrap())
}

#[tokio::test]
async fn planning_one_occurrence_moves_it_and_leaves_the_next_on_the_cycle_plan() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let run = weekly_run(&pool, &app, "week").await;
    let second_week = scope_id(&pool, ScopeKind::Week, ymd(2026, 1, 12)).await;
    let thursday = day(&pool, ymd(2026, 1, 8)).await;

    set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Planned {
            plan: thursday.clone(),
        },
    )
    .await
    .unwrap();

    let drawn = iterations(&app, run.flow_id, at(2026, 1, 13)).await;
    let this_week = run_in(&drawn, run.first_week);
    assert_eq!(
        this_week.plan,
        Some(thursday),
        "this week's run is on Thursday"
    );
    assert!(this_week.plan_overridden);
    assert_ne!(this_week.cycle_plan, this_week.plan);

    let next_week = run_in(&drawn, second_week);
    assert!(next_week.cycle_plan.is_some());
    assert_eq!(
        next_week.plan, next_week.cycle_plan,
        "next week goes back to the usual slot without anyone doing anything"
    );
    assert!(!next_week.plan_overridden);
}

#[tokio::test]
async fn an_occurrence_left_deliberately_unplanned_stays_unplanned_and_reads_as_touched() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let run = weekly_run(&pool, &app, "week").await;

    set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Unplanned,
    )
    .await
    .unwrap();

    let occurrence = run_in(
        &iterations(&app, run.flow_id, at(2026, 1, 6)).await,
        run.first_week,
    );
    assert_eq!(
        occurrence.plan, None,
        "the plan the user removed stays removed"
    );
    assert!(occurrence.cycle_plan.is_some());
    assert!(
        occurrence.plan_overridden,
        "unplanned on purpose is not the same as never touched"
    );
}

#[tokio::test]
async fn clearing_an_override_returns_the_occurrence_to_the_cycle_plan() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let run = weekly_run(&pool, &app, "week").await;
    let thursday = day(&pool, ymd(2026, 1, 8)).await;
    set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Planned { plan: thursday },
    )
    .await
    .unwrap();

    set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Inherit,
    )
    .await
    .unwrap();

    let occurrence = run_in(
        &iterations(&app, run.flow_id, at(2026, 1, 6)).await,
        run.first_week,
    );
    assert_eq!(occurrence.plan, occurrence.cycle_plan);
    assert!(!occurrence.plan_overridden);
}

#[tokio::test]
async fn a_plan_outside_the_occurrences_iteration_is_refused_as_a_containment_violation() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let run = weekly_run(&pool, &app, "week").await;
    let next_wednesday = day(&pool, ymd(2026, 1, 14)).await;

    let refused = set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Planned {
            plan: next_wednesday,
        },
    )
    .await
    .expect_err("next week is outside this week's occurrence");
    assert_eq!(refused["kind"].as_str(), Some("containment_violated"));

    let occurrence = run_in(
        &iterations(&app, run.flow_id, at(2026, 1, 6)).await,
        run.first_week,
    );
    assert!(
        !occurrence.plan_overridden,
        "a refusal leaves nothing behind"
    );
}

#[tokio::test]
async fn an_occurrence_with_a_day_cycle_scope_is_held_to_that_day_not_to_its_week() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    // The pair's Cycle Scope is the 2nd day of the week: Monday the 5th.
    let run = weekly_run(&pool, &app, "day").await;
    let thursday = day(&pool, ymd(2026, 1, 8)).await;
    let monday = day(&pool, ymd(2026, 1, 5)).await;

    let refused = set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Planned { plan: thursday },
    )
    .await
    .expect_err("Thursday is inside the iteration but outside Monday's occurrence");
    assert_eq!(refused["kind"].as_str(), Some("containment_violated"));

    set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Planned {
            plan: monday.clone(),
        },
    )
    .await
    .expect("the whole of its own day is a plan the occurrence can hold");
    let occurrence = run_in(
        &iterations(&app, run.flow_id, at(2026, 1, 6)).await,
        run.first_week,
    );
    assert_eq!(occurrence.plan, Some(monday));
}

#[tokio::test]
async fn a_future_occurrence_can_be_planned_before_its_iteration_arrives() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let run = weekly_run(&pool, &app, "week").await;
    let third_week = scope_id(&pool, ScopeKind::Week, ymd(2026, 1, 19)).await;
    let friday = day(&pool, ymd(2026, 1, 23)).await;

    set_plan(
        &app,
        run.flow_id,
        run.occurrence(third_week),
        PlanOverride::Planned {
            plan: friday.clone(),
        },
    )
    .await
    .expect("a pinned future occurrence is plannable");
    assert!(
        iterations(&app, run.flow_id, at(2026, 1, 6))
            .await
            .iter()
            .all(|iteration| iteration.anchor_scope_id != third_week),
        "the iteration has not begun, so nothing is drawn for it yet"
    );

    let occurrence = run_in(
        &iterations(&app, run.flow_id, at(2026, 1, 20)).await,
        third_week,
    );
    assert_eq!(
        occurrence.plan,
        Some(friday),
        "the override was waiting for it"
    );
}

#[tokio::test]
async fn a_task_habits_iteration_root_is_plannable_and_a_goal_habits_is_not() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let run = weekly_run(&pool, &app, "week").await;
    let root = HabitInstanceRef {
        item_type: "flow_root".into(),
        item_id: run.flow_id,
        iteration_scope_id: run.first_week,
        cycle_id: 0,
    };

    set_plan(&app, run.flow_id, root.clone(), PlanOverride::Unplanned)
        .await
        .expect("a task habit's iteration is a task, and a task is planned");

    flow_commands::update_flow(
        app.state(),
        run.flow_id,
        arlesh_lib::flows::model::UpdateFlowRequest {
            instance_type: Some(InstanceType::Goal),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let refused = set_plan(&app, run.flow_id, root, PlanOverride::Unplanned)
        .await
        .expect_err("a goal has no Plan");
    assert_eq!(refused["kind"].as_str(), Some("invalid_request"));
}

#[tokio::test]
async fn an_override_counts_as_a_divergence_for_the_habit_edit_prompt() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let run = weekly_run(&pool, &app, "week").await;
    assert_eq!(
        flow_commands::habit_completion_count(app.state(), run.flow_id)
            .await
            .unwrap(),
        0
    );

    set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Unplanned,
    )
    .await
    .unwrap();

    assert_eq!(
        flow_commands::habit_completion_count(app.state(), run.flow_id)
            .await
            .unwrap(),
        1,
        "editing the Habit's scope or repetition must ask before discarding it"
    );
}

#[tokio::test]
async fn unticking_an_occurrence_keeps_the_plan_it_was_given() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let run = weekly_run(&pool, &app, "week").await;
    let thursday = day(&pool, ymd(2026, 1, 8)).await;
    set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Planned {
            plan: thursday.clone(),
        },
    )
    .await
    .unwrap();

    for status in [Some("done".to_string()), None] {
        flow_commands::set_habit_item_status(
            app.state(),
            run.flow_id,
            run.occurrence(run.first_week),
            status,
            1_767_600_000_000,
            Some(true),
        )
        .await
        .unwrap();
    }
    flow_commands::set_habit_iteration_done(
        app.state(),
        run.flow_id,
        run.first_week,
        false,
        1_767_600_000_000,
        None,
    )
    .await
    .unwrap();

    let occurrence = run_in(
        &iterations(&app, run.flow_id, at(2026, 1, 6)).await,
        run.first_week,
    );
    assert_eq!(occurrence.plan, Some(thursday));
    assert!(occurrence.plan_overridden);
}

#[tokio::test]
async fn clearing_the_last_divergence_leaves_the_occurrence_with_no_modification() {
    // Storage stays proportional to the occurrences that differ: an occurrence given a plan and
    // then handed back holds nothing, so it no longer counts as divergent either.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let run = weekly_run(&pool, &app, "week").await;
    set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Unplanned,
    )
    .await
    .unwrap();

    set_plan(
        &app,
        run.flow_id,
        run.occurrence(run.first_week),
        PlanOverride::Inherit,
    )
    .await
    .unwrap();

    assert_eq!(
        flow_commands::habit_completion_count(app.state(), run.flow_id)
            .await
            .unwrap(),
        0
    );
}
