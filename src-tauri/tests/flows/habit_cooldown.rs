//! A Window Habit's cooldown (Task 199), and the done date it counts from.
//!
//! Each test builds a Habit through the commands, completes iterations at chosen instants, and
//! loads the board at a moment to ask whether the next iteration has opened yet.

use crate::helpers;

use arlesh_lib::commands::{flows as flow_commands, mindmap as mindmap_commands};
use arlesh_lib::flows::model::{
    ClockKind, CreateFlowRequest, FlowId, InstanceType, MissPolicy, SetRecurrenceRequest,
};
use arlesh_lib::mindmap::model::MindmapLoad;
use arlesh_lib::nodes::{
    id::NodeId,
    key::{OccurrenceKey, TemplateItem, TemplateKind},
    write,
};
use arlesh_lib::scopes::key::ScopeKey;
use arlesh_lib::scopes::model::ScopeKind;
use arlesh_lib::tasks::lifecycle::Timing;
use tauri::Manager;

type App = tauri::App<tauri::test::MockRuntime>;

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn at(instant: &str) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(instant, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn week(date: chrono::NaiveDate) -> ScopeKey {
    ScopeKey::containing(ScopeKind::Week, date).unwrap()
}

fn recurrence(
    start: ScopeKey,
    clock: ClockKind,
    policy: Option<MissPolicy>,
    cooldown: Option<(i64, &str)>,
) -> SetRecurrenceRequest {
    SetRecurrenceRequest {
        start_scope_id: start,
        gap_n: None,
        gap_kind: None,
        end_scope_id: None,
        clock,
        miss_policy: policy,
        cooldown_n: cooldown.map(|(n, _)| n),
        cooldown_kind: cooldown.map(|(_, kind)| kind.to_string()),
    }
}

/// A task flow with no items under the root aspect, of one `kind` period. Returns its id.
async fn flow(app: &App, kind: &str) -> i64 {
    flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Long run".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some(kind.to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
}

/// A weekly Window + Archive Habit from the week of 2026-09-20 with a one-day cooldown.
async fn weekly_with_a_day_of_cooldown(app: &App) -> i64 {
    let flow_id = flow(app, "week").await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow_id,
        recurrence(
            week(ymd(2026, 9, 20)),
            ClockKind::Window,
            Some(MissPolicy::Archive),
            Some((1, "day")),
        ),
    )
    .await
    .unwrap();
    flow_id
}

fn root_key(flow_id: i64, iteration: ScopeKey) -> OccurrenceKey {
    OccurrenceKey {
        item: TemplateItem {
            item_type: TemplateKind::FlowRoot,
            item_id: flow_id,
        },
        iteration,
        cycle: 0,
    }
}

async fn load(app: &App, instant: &str) -> MindmapLoad {
    mindmap_commands::load_mindmap(app.state(), app.state(), at(instant))
        .await
        .unwrap()
}

fn timing(board: &MindmapLoad, key: &OccurrenceKey) -> Timing {
    let id = NodeId::Derived(key.id());
    board
        .lifecycles
        .iter()
        .find(|lifecycle| lifecycle.node_id == id)
        .map(|lifecycle| lifecycle.timing)
        .unwrap_or_else(|| panic!("{} has a lifecycle", key.node_key()))
}

/// Marks a whole iteration done as if at `instant`.
async fn complete_at(pool: &sqlx::SqlitePool, flow_id: i64, iteration: ScopeKey, instant: &str) {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    arlesh_lib::flows::set_iteration_done(
        &mut db,
        FlowId(flow_id),
        iteration,
        true,
        at(instant).and_utc().timestamp_millis(),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
}

#[tokio::test]
async fn a_weekly_habit_done_on_saturday_opens_next_week_on_monday() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = weekly_with_a_day_of_cooldown(&app).await;
    complete_at(
        &pool,
        flow_id,
        week(ymd(2026, 9, 20)),
        "2026-09-26T19:00:00",
    )
    .await;
    let next = root_key(flow_id, week(ymd(2026, 9, 27)));

    let sunday = load(&app, "2026-09-27T10:00:00").await;
    assert_eq!(
        timing(&sunday, &next),
        Timing::Pending,
        "Sunday is the cooldown: the week is drawn, but has not opened"
    );
    let early_monday = load(&app, "2026-09-28T01:30:00").await;
    assert_eq!(
        timing(&early_monday, &next),
        Timing::Pending,
        "Monday begins at 02:00"
    );
    let monday = load(&app, "2026-09-28T02:00:00").await;
    assert_eq!(timing(&monday, &next), Timing::Active);
}

#[tokio::test]
async fn completing_the_held_iteration_holds_the_one_after_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = weekly_with_a_day_of_cooldown(&app).await;
    complete_at(
        &pool,
        flow_id,
        week(ymd(2026, 9, 20)),
        "2026-09-26T19:00:00",
    )
    .await;
    // The held week done on its own Saturday: the week after it is held in turn.
    complete_at(
        &pool,
        flow_id,
        week(ymd(2026, 9, 27)),
        "2026-10-03T20:00:00",
    )
    .await;
    let after = root_key(flow_id, week(ymd(2026, 10, 4)));

    assert_eq!(
        timing(&load(&app, "2026-10-04T10:00:00").await, &after),
        Timing::Pending
    );
    assert_eq!(
        timing(&load(&app, "2026-10-05T02:00:00").await, &after),
        Timing::Active
    );
}

#[tokio::test]
async fn a_completion_made_after_the_next_window_opened_leaves_it_open() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = weekly_with_a_day_of_cooldown(&app).await;
    // Marked done late — on the Monday of the next week.
    complete_at(
        &pool,
        flow_id,
        week(ymd(2026, 9, 20)),
        "2026-09-28T10:00:00",
    )
    .await;
    let next = root_key(flow_id, week(ymd(2026, 9, 27)));

    assert_eq!(
        timing(&load(&app, "2026-09-28T11:00:00").await, &next),
        Timing::Active
    );
}

#[tokio::test]
async fn setting_the_done_date_back_makes_the_cooldown_count_from_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = weekly_with_a_day_of_cooldown(&app).await;
    let first = root_key(flow_id, week(ymd(2026, 9, 20)));
    let next = root_key(flow_id, week(ymd(2026, 9, 27)));
    complete_at(&pool, flow_id, first.iteration, "2026-09-28T10:00:00").await;
    assert_eq!(
        timing(&load(&app, "2026-09-27T10:00:00").await, &next),
        Timing::Active,
        "a completion recorded on Monday holds nothing back on Sunday"
    );

    let now = at("2026-09-28T11:00:00");
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let id = NodeId::Derived(first.id());
    write::set_done_at(&mut db, &id, at("2026-09-26T19:00:00"), now)
        .await
        .unwrap();
    assert_eq!(
        write::done_at(&mut db, &id, now).await.unwrap(),
        Some(at("2026-09-26T19:00:00"))
    );
    db.commit().await.unwrap();

    assert_eq!(
        timing(&load(&app, "2026-09-27T10:00:00").await, &next),
        Timing::Pending,
        "dated back to Saturday, Sunday is its cooldown"
    );
}

#[tokio::test]
async fn a_done_date_in_the_future_or_on_an_open_task_is_refused() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = weekly_with_a_day_of_cooldown(&app).await;
    let first = root_key(flow_id, week(ymd(2026, 9, 20)));
    let id = NodeId::Derived(first.id());
    let now = at("2026-09-24T12:00:00");
    // Load once so the occurrence's id is known.
    load(&app, "2026-09-24T12:00:00").await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    assert!(
        write::set_done_at(&mut db, &id, at("2026-09-23T12:00:00"), now)
            .await
            .is_err(),
        "an open occurrence has no done date"
    );
    drop(db);

    complete_at(&pool, flow_id, first.iteration, "2026-09-24T11:00:00").await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    assert!(
        write::set_done_at(&mut db, &id, at("2026-09-25T12:00:00"), now)
            .await
            .is_err(),
        "nothing was done tomorrow"
    );
}

#[tokio::test]
async fn an_interval_done_date_that_would_move_a_done_successor_is_refused() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = flow(&app, "day").await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow_id,
        recurrence(
            ScopeKey::day(ymd(2026, 1, 5)),
            ClockKind::Interval,
            None,
            None,
        ),
    )
    .await
    .unwrap();
    complete_at(
        &pool,
        flow_id,
        ScopeKey::day(ymd(2026, 1, 5)),
        "2026-01-05T10:00:00",
    )
    .await;
    complete_at(
        &pool,
        flow_id,
        ScopeKey::day(ymd(2026, 1, 6)),
        "2026-01-06T10:00:00",
    )
    .await;
    load(&app, "2026-01-07T09:00:00").await;
    let first = NodeId::Derived(root_key(flow_id, ScopeKey::day(ymd(2026, 1, 5))).id());
    let now = at("2026-01-07T09:00:00");

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let refused = write::set_done_at(&mut db, &first, at("2026-01-06T09:00:00"), now).await;
    assert!(
        refused.is_err(),
        "done on the 6th would put the next instance on the 7th, leaving the done one behind"
    );
    write::set_done_at(&mut db, &first, at("2026-01-05T08:00:00"), now)
        .await
        .expect("an earlier time the same day moves nothing");
}

#[tokio::test]
async fn a_cooldown_is_refused_off_a_window_clock_and_past_the_window() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let weekly = flow(&app, "week").await;
    let start = week(ymd(2026, 9, 20));
    let refused = |request: SetRecurrenceRequest| {
        let app = &app;
        async move {
            flow_commands::set_flow_recurrence(app.state(), weekly, request)
                .await
                .is_err()
        }
    };
    assert!(
        refused(recurrence(
            start,
            ClockKind::Interval,
            None,
            Some((1, "day"))
        ))
        .await,
        "an interval's gap already counts from completion"
    );
    assert!(
        refused(recurrence(
            start,
            ClockKind::Window,
            Some(MissPolicy::Owed),
            Some((7, "day"))
        ))
        .await,
        "a week of cooldown could reach the end of the next week"
    );
    assert!(
        refused(recurrence(
            start,
            ClockKind::Window,
            Some(MissPolicy::Owed),
            Some((1, "week"))
        ))
        .await,
        "a weekly habit counts its cooldown in days"
    );

    let stored = flow_commands::set_flow_recurrence(
        app.state(),
        weekly,
        recurrence(
            start,
            ClockKind::Window,
            Some(MissPolicy::Overdue),
            Some((6, "day")),
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        (stored.cooldown_n, stored.cooldown_kind.as_deref()),
        (Some(6), Some("day"))
    );
}
