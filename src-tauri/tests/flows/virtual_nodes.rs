//! A Habit's occurrences as ordinary rows of their kinds (ADR 0008).
//!
//! Each test drives the board the way the app does — a command, then a load — and asks what an
//! occurrence *is* afterwards: which row it reads as, where it hangs, what a write to it did, and
//! what it refuses. The overlay rows are looked at only where their absence is the behaviour.

use std::borrow::Cow;

use crate::helpers;

use arlesh_lib::commands::{
    commitments as commitment_commands, flows as flow_commands, mindmap as mindmap_commands,
    retype as retype_commands, tasks as task_commands,
};
use arlesh_lib::flows::model::{
    ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowItemType,
    InstanceType, SetRecurrenceRequest,
};
use arlesh_lib::mindmap::model::MindmapLoad;
use arlesh_lib::nodes::{
    id::NodeId,
    key::{OccurrenceKey, TemplateItem, TemplateKind},
    origin::Origin,
};
use arlesh_lib::scopes::key::ScopeKey;
use arlesh_lib::scopes::model::{PartOfDay, ScopeKind};
use arlesh_lib::tasks::lifecycle::{Archival, Timing};
use arlesh_lib::tasks::model::{
    CreateTaskRequest, GoalStatus, TaskArchival, TaskStatus, TimeScope, UpdateCommitmentRequest,
    UpdateGoalRequest, UpdateTaskRequest, Verdict,
};
use tauri::Manager;

type App = tauri::App<tauri::test::MockRuntime>;

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn at(instant: &str) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(instant, "%Y-%m-%dT%H:%M:%S").unwrap()
}

/// The scope of `kind` holding `date`: a value, so nothing is written to name it.
async fn scope(_pool: &sqlx::SqlitePool, kind: ScopeKind, date: chrono::NaiveDate) -> ScopeKey {
    ScopeKey::containing(kind, date).unwrap()
}

/// A daily Habit of `instance_type` under the root aspect, recurring from 2026-01-05, with one
/// item "Stretch". Returns the flow id and the item id.
async fn daily_habit(
    pool: &sqlx::SqlitePool,
    app: &App,
    instance_type: InstanceType,
) -> (i64, i64) {
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Morning".into(),
            instance_type: Some(instance_type),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("day".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let item = if instance_type == InstanceType::Commitment {
        0
    } else {
        flow_commands::create_flow_task(
            app.state(),
            CreateFlowItemRequest {
                flow_id: flow.id,
                title: "Stretch".into(),
                parent_type: "flow".into(),
                parent_id: flow.id,
            },
        )
        .await
        .unwrap()
        .id
    };
    let start = scope(pool, ScopeKind::Day, ymd(2026, 1, 5)).await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: start,
            gap_n: None,
            gap_kind: None,
            end_scope_id: None,
            consumption_kind: ConsumptionKind::Accumulating,
            blocking_mode: Some(arlesh_lib::flows::model::BlockingMode::Overlapping),
            catchup_policy: None,
        },
    )
    .await
    .unwrap();
    (flow.id, item)
}

fn key(
    item_type: TemplateKind,
    item_id: i64,
    date: chrono::NaiveDate,
    cycle: i64,
) -> OccurrenceKey {
    OccurrenceKey {
        item: TemplateItem { item_type, item_id },
        iteration: ScopeKey::day(date),
        cycle,
    }
}

fn root(flow_id: i64, date: chrono::NaiveDate) -> NodeId {
    NodeId::Derived(key(TemplateKind::FlowRoot, flow_id, date, 0).id())
}

fn item(item_id: i64, date: chrono::NaiveDate) -> NodeId {
    NodeId::Derived(key(TemplateKind::FlowTask, item_id, date, 0).id())
}

async fn load(app: &App, instant: &str) -> MindmapLoad {
    mindmap_commands::load_mindmap(app.state(), at(instant))
        .await
        .unwrap()
}

#[tokio::test]
async fn every_occurrence_is_an_ordinary_row_with_a_habit_origin() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;

    let board = load(&app, "2026-01-06T09:00:00").await;
    let derived: Vec<_> = board
        .tasks
        .iter()
        .filter(|task| task.origin.is_derived())
        .collect();
    assert_eq!(derived.len(), 4, "two days, a root and one step each");

    let first_root = board
        .tasks
        .iter()
        .find(|task| task.id == root(flow_id, ymd(2026, 1, 5)))
        .expect("the first iteration's root is a Task row");
    assert_eq!(first_root.title, "Morning");
    assert_eq!(first_root.status, "todo");
    assert_eq!(
        (first_root.parent_type.as_str(), &first_root.parent_id),
        ("project", &NodeId::Stored(1)),
        "a root hangs on the Habit's host"
    );
    let Origin::Habit(origin) = &first_root.origin else {
        panic!("a derived row names its Habit");
    };
    assert_eq!(origin.habit_id, flow_id);
    assert!(origin.is_root());
    assert_eq!(origin.iteration_scope.start_date, ymd(2026, 1, 5));

    let step = board
        .tasks
        .iter()
        .find(|task| task.id == item(item_id, ymd(2026, 1, 5)))
        .expect("each item draws a Task row per iteration");
    assert_eq!(step.title, "Stretch");
    assert_eq!(
        (step.parent_type.as_str(), &step.parent_id),
        ("task", &root(flow_id, ymd(2026, 1, 5))),
        "an item hangs on its iteration's root, by the root's derived id"
    );

    let lifecycle = board
        .lifecycles
        .iter()
        .find(|lifecycle| lifecycle.node_id == step.id)
        .expect("a derived row has a lifecycle like any other");
    assert_eq!(
        lifecycle.timing,
        Timing::Active,
        "yesterday's step piles up under Overlapping rather than lapsing"
    );
    assert_eq!(lifecycle.archival, Archival::Live);

    let wire = serde_json::to_value(step).unwrap();
    assert!(
        wire["id"].is_string(),
        "a derived id travels as a UUID string"
    );
    assert_eq!(wire["origin"]["kind"], "habit");
}

#[tokio::test]
async fn editing_an_occurrence_writes_that_occurrence_only() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;
    load(&app, "2026-01-06T09:00:00").await;

    let today = item(item_id, ymd(2026, 1, 6));
    let edited = task_commands::update_task(
        app.state(),
        today.clone(),
        UpdateTaskRequest {
            title: Some("Stretch longer".into()),
            status: Some(TaskStatus::InProgress),
            is_private: Some(true),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(edited.id, today);
    assert_eq!(edited.title, "Stretch longer");
    assert_eq!(edited.status, "in_progress");
    assert!(edited.is_private);

    let board = load(&app, "2026-01-06T09:00:00").await;
    let yesterday = board
        .tasks
        .iter()
        .find(|task| task.id == item(item_id, ymd(2026, 1, 5)))
        .unwrap();
    assert_eq!(
        yesterday.title, "Stretch",
        "the other occurrence is untouched"
    );
    assert_eq!(yesterday.status, "todo");
    let templates = flow_commands::list_flow_tasks(app.state(), flow_id)
        .await
        .unwrap();
    assert_eq!(templates[0].title, "Stretch", "and so is the template");
}

#[tokio::test]
async fn setting_a_field_back_to_its_templates_value_clears_the_override() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;
    load(&app, "2026-01-05T09:00:00").await;
    let today = item(item_id, ymd(2026, 1, 5));

    for title in ["Stretch longer", "Stretch"] {
        task_commands::update_task(
            app.state(),
            today.clone(),
            UpdateTaskRequest {
                title: Some(title.into()),
                ..Default::default()
            },
            None,
        )
        .await
        .unwrap();
    }
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_overlays")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 0, "an overlay that says nothing is not kept");
}

#[tokio::test]
async fn an_occurrence_plans_backlogs_and_delegates_like_a_task() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;
    load(&app, "2026-01-05T09:00:00").await;
    let today = item(item_id, ymd(2026, 1, 5));
    let morning = ScopeKey::part(ymd(2026, 1, 5), PartOfDay::Morning);

    let planned = task_commands::update_task(
        app.state(),
        today.clone(),
        UpdateTaskRequest {
            plan: Some(Some(TimeScope {
                start_id: morning,
                end_id: morning,
                duration: None,
            })),
            delegate_to: Some(Some(arlesh_lib::tasks::model::Delegate::Agent)),
            agentic: Some(arlesh_lib::tasks::model::TaskAgentic::Yes),
            asynchronous: Some(true),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(planned.plan.map(|plan| plan.start_id), Some(morning));
    assert_eq!(
        planned.delegate_to,
        Some(arlesh_lib::tasks::model::Delegate::Agent)
    );
    assert_eq!(planned.agentic, Some(true));
    assert!(planned.asynchronous);

    let refused = task_commands::update_task(
        app.state(),
        today.clone(),
        UpdateTaskRequest {
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
        None,
    )
    .await
    .expect_err("a planned occurrence is not backlogged without the question");
    assert_eq!(
        serde_json::to_value(&refused).unwrap()["kind"],
        "needs_confirmation"
    );

    let backlogged = task_commands::update_task(
        app.state(),
        today,
        UpdateTaskRequest {
            archival: Some(TaskArchival::Backlog),
            plan: Some(None),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(backlogged.archival, TaskArchival::Backlog);
    assert_eq!(backlogged.plan, None);
}

#[tokio::test]
async fn a_plan_outside_the_occurrences_window_is_refused() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;
    load(&app, "2026-01-05T09:00:00").await;
    let tomorrow = scope(&pool, ScopeKind::Day, ymd(2026, 1, 6)).await;
    let refused = task_commands::update_task(
        app.state(),
        item(item_id, ymd(2026, 1, 5)),
        UpdateTaskRequest {
            plan: Some(Some(TimeScope {
                start_id: tomorrow,
                end_id: tomorrow,
                duration: None,
            })),
            ..Default::default()
        },
        None,
    )
    .await
    .expect_err("an occurrence is planned within its own window");
    assert_eq!(
        serde_json::to_value(&refused).unwrap()["kind"],
        "containment_violated"
    );
}

#[tokio::test]
async fn an_occurrence_cannot_leave_its_iteration() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;
    load(&app, "2026-01-05T09:00:00").await;
    let today = item(item_id, ymd(2026, 1, 5));

    let moved = task_commands::update_task(
        app.state(),
        today.clone(),
        UpdateTaskRequest {
            parent_type: Some("project".into()),
            parent_id: Some(1.into()),
            ..Default::default()
        },
        None,
    )
    .await
    .expect_err("moving it out of its iteration is refused");
    let message = serde_json::to_value(&moved).unwrap()["message"].to_string();
    assert!(message.contains("iteration"), "{message}");

    let tomorrow = scope(&pool, ScopeKind::Day, ymd(2026, 1, 6)).await;
    let rescoped = task_commands::update_task(
        app.state(),
        today.clone(),
        UpdateTaskRequest {
            time_scope: Some(Some(TimeScope {
                start_id: tomorrow,
                end_id: tomorrow,
                duration: None,
            })),
            ..Default::default()
        },
        None,
    )
    .await;
    assert!(rescoped.is_err(), "and so is giving it another window");

    let retyped =
        retype_commands::retype_node(app.state(), "task".into(), today, "goal".into(), None, None)
            .await
            .expect_err("an occurrence cannot change kind");
    let message = serde_json::to_value(&retyped).unwrap()["message"].to_string();
    assert!(message.contains("kind"), "{message}");
}

#[tokio::test]
async fn deleting_an_occurrence_archives_it_and_a_status_brings_it_back() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;
    load(&app, "2026-01-05T09:00:00").await;
    let today = item(item_id, ymd(2026, 1, 5));

    task_commands::delete_task(app.state(), today.clone())
        .await
        .unwrap();
    let board = load(&app, "2026-01-05T09:00:00").await;
    assert!(
        board.tasks.iter().any(|task| task.id == today),
        "it is still there: an occurrence is never deleted"
    );
    let archived = board
        .lifecycles
        .iter()
        .find(|lifecycle| lifecycle.node_id == today)
        .unwrap();
    assert_eq!(archived.archival, Archival::Archived);

    task_commands::update_task(
        app.state(),
        today.clone(),
        UpdateTaskRequest {
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    let board = load(&app, "2026-01-05T09:00:00").await;
    let back = board
        .lifecycles
        .iter()
        .find(|lifecycle| lifecycle.node_id == today)
        .unwrap();
    assert_eq!(back.archival, Archival::Live, "a status gives it back");
}

#[tokio::test]
async fn a_goal_occurrence_is_achieved_and_a_commitment_iteration_judged() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (goal_flow, _) = daily_habit(&pool, &app, InstanceType::Goal).await;
    let (commitment_flow, _) = daily_habit(&pool, &app, InstanceType::Commitment).await;
    load(&app, "2026-01-05T09:00:00").await;

    let goal = task_commands::update_goal(
        app.state(),
        root(goal_flow, ymd(2026, 1, 5)),
        UpdateGoalRequest {
            status: Some(GoalStatus::Achieved),
            title: Some("A good morning".into()),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(goal.status, "achieved");
    assert_eq!(goal.title, "A good morning");

    let commitment = commitment_commands::update_commitment(
        app.state(),
        root(commitment_flow, ymd(2026, 1, 5)),
        UpdateCommitmentRequest {
            verdict: Some(Verdict::Kept),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(commitment.verdict, Verdict::Kept);
    assert!(
        commitment.time_scope.is_some(),
        "its window is its iteration's"
    );

    let other = commitment_commands::update_commitment(
        app.state(),
        root(commitment_flow, ymd(2026, 1, 5)),
        UpdateCommitmentRequest {
            verdict_window: Some(Some(arlesh_lib::tasks::model::DurationSpec {
                n: 3,
                kind: "day".into(),
            })),
            ..Default::default()
        },
    )
    .await;
    assert!(other.is_err(), "the Verdict Window is the Habit's");

    commitment_commands::delete_commitment(app.state(), root(commitment_flow, ymd(2026, 1, 5)))
        .await
        .unwrap();
    task_commands::delete_goal(app.state(), root(goal_flow, ymd(2026, 1, 5)))
        .await
        .unwrap();
    let board = load(&app, "2026-01-05T09:00:00").await;
    for id in [
        root(goal_flow, ymd(2026, 1, 5)),
        root(commitment_flow, ymd(2026, 1, 5)),
    ] {
        let lifecycle = board
            .lifecycles
            .iter()
            .find(|lifecycle| lifecycle.node_id == id)
            .unwrap();
        assert_eq!(lifecycle.archival, Archival::Archived);
    }
}

#[tokio::test]
async fn a_write_names_the_kind_it_is() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (goal_flow, _) = daily_habit(&pool, &app, InstanceType::Goal).await;
    load(&app, "2026-01-05T09:00:00").await;
    let refused = task_commands::update_task(
        app.state(),
        root(goal_flow, ymd(2026, 1, 5)),
        UpdateTaskRequest {
            title: Some("x".into()),
            ..Default::default()
        },
        None,
    )
    .await;
    assert!(
        refused.is_err(),
        "a Goal occurrence is not written as a Task"
    );

    let unknown = task_commands::update_task(
        app.state(),
        NodeId::Derived(arlesh_lib::nodes::id::DerivedId::of_key(
            "flow_task:999:2026-01-05:0",
        )),
        UpdateTaskRequest::default(),
        None,
    )
    .await
    .expect_err("an id no Habit derives is not found");
    assert_eq!(serde_json::to_value(&unknown).unwrap()["kind"], "not_found");
}

#[tokio::test]
async fn a_future_occurrence_with_an_edit_stays_on_the_board() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;
    let far = item(item_id, ymd(2026, 1, 20));

    let before = load(&app, "2026-01-05T09:00:00").await;
    assert!(
        before.tasks.iter().all(|task| task.id != far),
        "the future is not drawn unless something asks for it"
    );

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    arlesh_lib::flows::occurrence_edit::update_task(
        &mut db,
        &key(TemplateKind::FlowTask, item_id, ymd(2026, 1, 20), 0),
        UpdateTaskRequest {
            title: Some("Stretch, far ahead".into()),
            ..Default::default()
        },
        at("2026-01-05T09:00:00"),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let after = load(&app, "2026-01-05T09:00:00").await;
    let drawn = after
        .tasks
        .iter()
        .find(|task| task.id == far)
        .expect("an edited future occurrence is never lost");
    assert_eq!(drawn.title, "Stretch, far ahead");
    let lifecycle = after
        .lifecycles
        .iter()
        .find(|lifecycle| lifecycle.node_id == far)
        .unwrap();
    assert_eq!(
        lifecycle.timing,
        Timing::Pending,
        "its window has not opened"
    );
}

#[tokio::test]
async fn a_stored_child_of_an_occurrence_hangs_on_it_in_the_load() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _) = daily_habit(&pool, &app, InstanceType::Task).await;
    let parent = key(TemplateKind::FlowRoot, flow_id, ymd(2026, 1, 5), 0);
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let child =
        arlesh_lib::flows::create_instance_child(&mut db, &parent, "task", "buy milk".into())
            .await
            .unwrap();
    db.commit().await.unwrap();

    let board = load(&app, "2026-01-05T09:00:00").await;
    let task = board
        .tasks
        .iter()
        .find(|task| task.id == NodeId::Stored(child.node_id))
        .unwrap();
    assert_eq!(task.parent_type, "task");
    assert_eq!(task.parent_id, NodeId::Derived(parent.id()));
    assert_eq!(task.origin, Origin::Manual, "the child itself is stored");
}

#[tokio::test]
async fn the_list_commands_serve_the_virtual_tables() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    daily_habit(&pool, &app, InstanceType::Task).await;
    let tasks = task_commands::list_tasks(app.state(), at("2026-01-05T09:00:00"))
        .await
        .unwrap();
    assert!(tasks.iter().any(|task| task.origin.is_derived()));
    let goals = task_commands::list_goals(app.state(), at("2026-01-05T09:00:00"))
        .await
        .unwrap();
    assert!(goals.is_empty());
    let commitments = commitment_commands::list_commitments(app.state(), at("2026-01-05T09:00:00"))
        .await
        .unwrap();
    assert!(commitments.is_empty());
}

#[tokio::test]
async fn a_cycle_pair_draws_its_own_occurrence_with_its_own_window() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;
    flow_commands::set_flow_item_cycles(
        app.state(),
        flow_id,
        FlowItemType::FlowTask,
        item_id,
        vec![
            FlowCycleInput {
                scope_kind: Some("part_of_day".into()),
                scope_index: Some(1),
                plan_kind: None,
                plan_start: None,
                plan_end: None,
            },
            FlowCycleInput {
                scope_kind: Some("part_of_day".into()),
                scope_index: Some(4),
                plan_kind: None,
                plan_start: None,
                plan_end: None,
            },
        ],
        None,
        None,
    )
    .await
    .unwrap();

    let board = load(&app, "2026-01-05T09:00:00").await;
    let occurrences: Vec<_> = board
        .tasks
        .iter()
        .filter(|task| {
            task.origin.habit().is_some_and(|origin| {
                origin.item_type == TemplateKind::FlowTask && origin.item_id == item_id
            }) && task.origin.habit().unwrap().iteration_scope.start_date == ymd(2026, 1, 5)
        })
        .collect();
    assert_eq!(occurrences.len(), 2, "a morning and an evening occurrence");
    assert!(occurrences.iter().all(|task| task.time_scope.is_some()));
    let pending = board
        .lifecycles
        .iter()
        .filter(|lifecycle| occurrences.iter().any(|task| task.id == lifecycle.node_id))
        .filter(|lifecycle| lifecycle.timing == Timing::Pending)
        .count();
    assert_eq!(pending, 1, "the evening one has not opened at nine");
}

#[tokio::test]
async fn completing_every_occurrence_resolves_the_iteration() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, item_id) = daily_habit(&pool, &app, InstanceType::Task).await;
    load(&app, "2026-01-05T09:00:00").await;
    for id in [
        root(flow_id, ymd(2026, 1, 5)),
        item(item_id, ymd(2026, 1, 5)),
    ] {
        task_commands::update_task(
            app.state(),
            id,
            UpdateTaskRequest {
                status: Some(TaskStatus::Done),
                ..Default::default()
            },
            None,
        )
        .await
        .unwrap();
    }
    let board = load(&app, "2026-01-06T09:00:00").await;
    let first = board
        .tasks
        .iter()
        .find(|task| task.id == root(flow_id, ymd(2026, 1, 5)))
        .unwrap();
    assert_eq!(
        first.origin.habit().unwrap().iteration_scope.status,
        arlesh_lib::flows::model::IterationStatus::Done
    );
}

#[tokio::test]
async fn a_stored_task_is_still_written_where_it_always_was() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let task = task_commands::create_task(
        app.state(),
        CreateTaskRequest {
            title: "Ordinary".into(),
            parent_type: "project".into(),
            parent_id: 1.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let renamed = task_commands::update_task(
        app.state(),
        task.id.clone(),
        UpdateTaskRequest {
            title: Some("Still ordinary".into()),
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(renamed.title, "Still ordinary");
    assert_eq!(renamed.origin, Origin::Manual);
    task_commands::delete_task(app.state(), task.id)
        .await
        .unwrap();
}

// ---------------------------------------------------------------------------------------------
// Migration 0060
// ---------------------------------------------------------------------------------------------

/// One `task_overlays` row as the migration test reads it: key, status, title, tombstone,
/// resolved at, and whether its block reasons are its own.
type TaskOverlayRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
    i64,
);

/// A database migrated to just before 0060.
async fn pool_before_0060() -> sqlx::SqlitePool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let everything = sqlx::migrate!("./migrations");
    let before = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            everything
                .migrations
                .iter()
                .filter(|migration| migration.version < 60)
                .cloned()
                .collect(),
        ),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    };
    before.run(&pool).await.unwrap();
    pool
}

#[tokio::test]
async fn migration_0060_carries_every_modification_into_its_kinds_overlay() {
    let pool = pool_before_0060().await;
    sqlx::query(
        "INSERT INTO flows (id, title, instance_type, parent_type, parent_id, flow_duration_n,
                            flow_duration_kind) VALUES
            (1, 'Tasks', 'task', 'aspect', 1, 1, 'day'),
            (2, 'Goals', 'goal', 'aspect', 1, 1, 'day'),
            (3, 'Vows', 'commitment', 'aspect', 1, 1, 'day');
         UPDATE flows SET flow_window_part = 'evening', flow_duration_kind = 'part' WHERE id = 3;
         INSERT INTO flow_tasks (id, flow_id, title, parent_type, parent_id) VALUES
            (10, 1, 'Step', 'flow', 1), (11, 2, 'Goal step', 'flow', 2);
         INSERT INTO habit_instance_modifications
            (flow_id, item_type, item_id, iteration_scope_id, cycle_id, status, title,
             blocked_reason, tombstone_kind, resolved_at) VALUES
            (1, 'flow_root', 1, '{\"kind\":\"day\",\"date\":\"2026-01-05\"}', 0, 'done', NULL, NULL, NULL, 100),
            (1, 'flow_task', 10, '{\"kind\":\"day\",\"date\":\"2026-01-05\"}', 0, 'in_progress', 'Own title', 'stuck', NULL, NULL),
            (1, 'flow_task', 10, '{\"kind\":\"day\",\"date\":\"2026-01-06\"}', 0, NULL, NULL, NULL, 'deleted', NULL),
            (2, 'flow_root', 2, '{\"kind\":\"day\",\"date\":\"2026-01-05\"}', 0, 'done', NULL, NULL, NULL, 200),
            (2, 'flow_task', 11, '{\"kind\":\"day\",\"date\":\"2026-01-05\"}', 0, 'done', NULL, NULL, 'missed', 300),
            (3, 'flow_root', 3, '{\"kind\":\"day\",\"date\":\"2026-01-05\"}', 0, 'kept', NULL, NULL, NULL, 400),
            (3, 'flow_root', 3, '{\"kind\":\"part_of_day\",\"date\":\"2026-01-05\",\"part\":\"evening\"}', 0, 'broken', NULL, NULL, NULL, 500),
            (3, 'flow_root', 3, '{\"kind\":\"day\",\"date\":\"2026-01-06\"}', 0, 'done', NULL, NULL, NULL, 600);
         INSERT INTO tasks (id, title, parent_type, parent_id) VALUES (70, 'Milk', 'project', 1);
         INSERT INTO habit_instance_children
            (flow_id, item_type, item_id, iteration_scope_id, cycle_id, window_end_scope_id,
             child_type, child_id) VALUES (1, 'flow_root', 1, '{\"kind\":\"day\",\"date\":\"2026-01-05\"}', 0, '{\"kind\":\"day\",\"date\":\"2026-01-05\"}', 'task', 70);",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::migrate!("./migrations").run(&pool).await.unwrap();

    let tasks: Vec<TaskOverlayRow> = sqlx::query_as(
        "SELECT node_key, status, title, tombstone, resolved_at, block_reasons_set
             FROM task_overlays ORDER BY node_key",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        tasks,
        vec![
            (
                "flow_root:1:{\"kind\":\"day\",\"date\":\"2026-01-05\"}:0".into(),
                Some("done".into()),
                None,
                None,
                Some(100),
                0
            ),
            (
                "flow_task:10:{\"kind\":\"day\",\"date\":\"2026-01-05\"}:0".into(),
                Some("in_progress".into()),
                Some("Own title".into()),
                None,
                None,
                1
            ),
            (
                "flow_task:10:{\"kind\":\"day\",\"date\":\"2026-01-06\"}:0".into(),
                None,
                None,
                Some("archived".into()),
                None,
                0
            ),
            (
                "flow_task:11:{\"kind\":\"day\",\"date\":\"2026-01-05\"}:0".into(),
                Some("done".into()),
                None,
                Some("missed".into()),
                Some(300),
                0
            ),
        ],
        "a task's status carries as itself; a deleted tombstone becomes archived"
    );

    let goals: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT node_key, status FROM goal_overlays ORDER BY node_key")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        goals,
        vec![(
            "flow_root:2:{\"kind\":\"day\",\"date\":\"2026-01-05\"}:0".into(),
            Some("achieved".into())
        )],
        "a goal's done is achieved"
    );

    let commitments: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT node_key, verdict FROM commitment_overlays ORDER BY node_key")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        commitments,
        vec![
            ("flow_root:3:{\"kind\":\"day\",\"date\":\"2026-01-05\"}:0".into(), Some("kept".into())),
            (
                "flow_root:3:{\"kind\":\"part_of_day\",\"date\":\"2026-01-05\",\"part\":\"evening\"}:0".into(),
                Some("broken".into())
            ),
        ],
        "each verdict carries under its own iteration key; a stale done is no verdict, and an \
         overlay left saying nothing is not kept"
    );

    let reasons: Vec<(String, String)> =
        sqlx::query_as("SELECT node_key, reason FROM derived_block_reasons")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        reasons,
        vec![(
            "flow_task:10:{\"kind\":\"day\",\"date\":\"2026-01-05\"}:0".into(),
            "stuck".into()
        )]
    );

    let children: Vec<(String, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT parent_key, child_type, child_id, window_start_scope_id FROM derived_children",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        children,
        vec![(
            "flow_root:1:{\"kind\":\"day\",\"date\":\"2026-01-05\"}:0".into(),
            "task".into(),
            70,
            Some("{\"kind\":\"day\",\"date\":\"2026-01-05\"}".into())
        )]
    );

    let gone: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE name = 'habit_instance_modifications'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(gone, 0, "the polymorphic overlay is dropped");
}

/// The derived Task titled `title` whose window opens at `start`.
fn occurrence_starting<'a>(
    board: &'a MindmapLoad,
    title: &str,
    start: ScopeKey,
) -> &'a arlesh_lib::tasks::model::Task {
    board
        .tasks
        .iter()
        .find(|task| {
            task.origin.is_derived()
                && task.title == title
                && task.time_scope.as_ref().map(|scope| scope.start_id) == Some(start)
        })
        .unwrap_or_else(|| panic!("no occurrence of {title} opening at {start}"))
}

#[tokio::test]
async fn a_root_and_an_item_cycle_plan_resolve_onto_their_occurrences() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    // A weekly task Habit whose root is planned into Day 2 of the week, with one item on Day 3
    // planned into that day's first part — its morning.
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Weekly".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some("week".into()),
            root_plan_kind: Some("day".into()),
            root_plan_start: Some(2),
            root_plan_end: Some(2),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let prepare = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Prepare".into(),
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
        prepare.id,
        vec![FlowCycleInput {
            scope_kind: Some("day".into()),
            scope_index: Some(3),
            plan_kind: Some("part_of_day".into()),
            plan_start: Some(1),
            plan_end: Some(1),
        }],
        None,
        None,
    )
    .await
    .unwrap();
    let week = scope(&pool, ScopeKind::Week, ymd(2026, 1, 5)).await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: week,
            gap_n: None,
            gap_kind: None,
            end_scope_id: None,
            consumption_kind: ConsumptionKind::Accumulating,
            blocking_mode: Some(arlesh_lib::flows::model::BlockingMode::Overlapping),
            catchup_policy: None,
        },
    )
    .await
    .unwrap();

    let board = load(&app, "2026-01-05T09:00:00").await;

    // The week opens on Sunday 2026-01-04, so its Day 2 is the 5th and its Day 3 the 6th.
    let root_id = NodeId::Derived(
        OccurrenceKey {
            item: TemplateItem {
                item_type: TemplateKind::FlowRoot,
                item_id: flow.id,
            },
            iteration: week,
            cycle: 0,
        }
        .id(),
    );
    let root = board
        .tasks
        .iter()
        .find(|task| task.id == root_id)
        .expect("the week's root occurrence");
    let monday = ScopeKey::day(ymd(2026, 1, 5));
    assert_eq!(
        root.plan.as_ref().map(|plan| (plan.start_id, plan.end_id)),
        Some((monday, monday)),
        "the root reads the flow's root Cycle Plan"
    );
    let tuesday = ScopeKey::day(ymd(2026, 1, 6));
    let item = occurrence_starting(&board, "Prepare", tuesday);
    let morning = ScopeKey::part(ymd(2026, 1, 6), PartOfDay::Morning);
    assert_eq!(
        item.plan.as_ref().map(|plan| (plan.start_id, plan.end_id)),
        Some((morning, morning)),
        "the item reads its pair's Cycle Plan"
    );
}
