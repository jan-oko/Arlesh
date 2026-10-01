//! A Habit's clock (Task #245): Window with a miss policy of Archive, Owed or Overdue, or
//! Interval — and the due each gives its occurrences.
//!
//! Each test builds a Habit through the commands, drives it to a moment with a load, and asks
//! what its occurrences read as there: their window, their due, and whether they are Overdue.

use crate::helpers;

use arlesh_lib::commands::{
    flows as flow_commands, mindmap as mindmap_commands, tasks as task_commands,
};
use arlesh_lib::flows::model::{
    ClockKind, CreateFlowRequest, FlowId, InstanceType, MissPolicy, SetRecurrenceRequest,
};
use arlesh_lib::mindmap::model::MindmapLoad;
use arlesh_lib::nodes::{
    id::NodeId,
    key::{OccurrenceKey, TemplateItem, TemplateKind},
};
use arlesh_lib::scopes::key::ScopeKey;
use arlesh_lib::scopes::model::ScopeKind;
use arlesh_lib::tasks::lifecycle::{Archival, ItemLifecycle, Resolution, Timing};
use arlesh_lib::tasks::model::{Task, TimeScope, UpdateTaskRequest};
use tauri::Manager;

type App = tauri::App<tauri::test::MockRuntime>;

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn at(instant: &str) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(instant, "%Y-%m-%dT%H:%M:%S").unwrap()
}

/// A task Habit with no items under the root aspect, of one `kind` period (`None`: Unscoped),
/// recurring from `start` by `clock` and `policy`. Returns the flow id.
async fn habit(
    app: &App,
    kind: Option<&str>,
    start: ScopeKey,
    clock: ClockKind,
    policy: Option<MissPolicy>,
    gap: Option<(i64, &str)>,
) -> i64 {
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Water the plants".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: kind.map(|_| 1),
            flow_duration_kind: kind.map(str::to_string),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: start,
            gap_n: gap.map(|(n, _)| n),
            gap_kind: gap.map(|(_, kind)| kind.to_string()),
            end_scope_id: None,
            clock,
            miss_policy: policy,
            cooldown_n: None,
            cooldown_kind: None,
        },
    )
    .await
    .unwrap();
    flow.id
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

fn day(date: chrono::NaiveDate) -> ScopeKey {
    ScopeKey::day(date)
}

fn week(date: chrono::NaiveDate) -> ScopeKey {
    ScopeKey::containing(ScopeKind::Week, date).unwrap()
}

async fn load(app: &App, instant: &str) -> MindmapLoad {
    mindmap_commands::load_mindmap(app.state(), app.state(), at(instant))
        .await
        .unwrap()
}

fn task(board: &MindmapLoad, key: &OccurrenceKey) -> Option<Task> {
    let id = NodeId::Derived(key.id());
    board.tasks.iter().find(|task| task.id == id).cloned()
}

fn lifecycle(board: &MindmapLoad, key: &OccurrenceKey) -> ItemLifecycle {
    let id = NodeId::Derived(key.id());
    board
        .lifecycles
        .iter()
        .find(|lifecycle| lifecycle.node_id == id)
        .cloned()
        .unwrap_or_else(|| panic!("{} has a lifecycle", key.node_key()))
}

/// The roots of this Habit's iterations on the board, by the iteration they key on.
fn roots(board: &MindmapLoad, flow_id: i64) -> Vec<ScopeKey> {
    board
        .tasks
        .iter()
        .filter_map(|task| task.origin.habit())
        .filter(|habit| habit.habit_id == flow_id && habit.item_type == TemplateKind::FlowRoot)
        .map(|habit| habit.iteration_scope.scope_id)
        .collect()
}

/// Asserts two lists of iterations hold the same ones, in whatever order the board lists them.
fn assert_same(actual: Vec<ScopeKey>, expected: Vec<ScopeKey>) {
    let text = |keys: &[ScopeKey]| {
        let mut texts: Vec<String> = keys.iter().map(ScopeKey::canonical).collect();
        texts.sort();
        texts
    };
    assert_eq!(text(&actual), text(&expected));
}

/// Marks a whole iteration done as if at `instant`, the completion an Interval clock reads.
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
async fn window_overdue_archives_what_it_missed_and_the_open_iteration_carries_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let start = day(ymd(2026, 1, 5));
    let flow_id = habit(
        &app,
        Some("day"),
        start,
        ClockKind::Window,
        Some(MissPolicy::Overdue),
        None,
    )
    .await;

    let board = load(&app, "2026-01-07T09:00:00").await;
    for missed in [ymd(2026, 1, 5), ymd(2026, 1, 6)] {
        let state = lifecycle(&board, &root_key(flow_id, day(missed)));
        assert_eq!(state.resolution, Some(Resolution::Missed), "{missed}");
        assert_eq!(state.archival, Archival::Archived, "{missed}");
        assert!(!state.overdue, "an archived iteration is never Overdue");
    }

    let open = root_key(flow_id, day(ymd(2026, 1, 7)));
    let row = task(&board, &open).expect("the iteration open now is on the board");
    let origin = row.origin.habit().unwrap();
    assert_eq!(
        origin.iteration_scope.missed_from,
        Some(ymd(2026, 1, 5)),
        "it is drawn \"Jan 7 from Jan 5\""
    );
    let relevance = row.time_scope.expect("its relevance");
    assert_eq!(
        (relevance.start_id, relevance.end_id),
        (day(ymd(2026, 1, 5)), day(ymd(2026, 1, 7))),
        "its relevance reaches back to the first missed window"
    );
    let state = lifecycle(&board, &open);
    assert_eq!(state.timing, Timing::Active);
    assert_eq!(state.archival, Archival::Live);
    assert!(
        state.overdue,
        "it is due at the first missed window, long past"
    );
}

#[tokio::test]
async fn window_overdue_starts_afresh_once_one_is_completed() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = habit(
        &app,
        Some("day"),
        day(ymd(2026, 1, 5)),
        ClockKind::Window,
        Some(MissPolicy::Overdue),
        None,
    )
    .await;
    complete_at(&pool, flow_id, day(ymd(2026, 1, 7)), "2026-01-07T10:00:00").await;

    let board = load(&app, "2026-01-08T09:00:00").await;
    let next = root_key(flow_id, day(ymd(2026, 1, 8)));
    let row = task(&board, &next).unwrap();
    assert_eq!(
        row.origin.habit().unwrap().iteration_scope.missed_from,
        None
    );
    assert!(
        !lifecycle(&board, &next).overdue,
        "nothing is carried past a completion"
    );

    let done = task(&board, &root_key(flow_id, day(ymd(2026, 1, 7)))).unwrap();
    assert_eq!(
        done.origin.habit().unwrap().iteration_scope.missed_from,
        Some(ymd(2026, 1, 5)),
        "the done iteration keeps saying which windows it made up for"
    );
}

#[tokio::test]
async fn window_owed_keeps_a_missed_iteration_open_and_overdue_beside_the_next() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = habit(
        &app,
        Some("day"),
        day(ymd(2026, 1, 5)),
        ClockKind::Window,
        Some(MissPolicy::Owed),
        None,
    )
    .await;

    let board = load(&app, "2026-01-07T09:00:00").await;
    let owed = lifecycle(&board, &root_key(flow_id, day(ymd(2026, 1, 5))));
    assert_eq!(
        (owed.timing, owed.archival),
        (Timing::Active, Archival::Live)
    );
    assert!(owed.overdue, "due at its own window, which has passed");
    assert!(!lifecycle(&board, &root_key(flow_id, day(ymd(2026, 1, 7)))).overdue);

    // Owed work is said so on the origin, which keeps it out of the board's folded history.
    let is_owed = |date| {
        task(&board, &root_key(flow_id, day(date)))
            .unwrap()
            .origin
            .habit()
            .unwrap()
            .iteration_scope
            .owed
    };
    assert!(is_owed(ymd(2026, 1, 5)), "passed and still open: owed");
    assert!(!is_owed(ymd(2026, 1, 7)), "its window is still open");

    // Done, it is no longer owed and folds like any passed iteration.
    complete_at(&pool, flow_id, day(ymd(2026, 1, 5)), "2026-01-07T08:00:00").await;
    let board = load(&app, "2026-01-07T09:00:00").await;
    let done = task(&board, &root_key(flow_id, day(ymd(2026, 1, 5)))).unwrap();
    assert!(!done.origin.habit().unwrap().iteration_scope.owed);
}

#[tokio::test]
async fn window_archive_is_never_overdue() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = habit(
        &app,
        Some("day"),
        day(ymd(2026, 1, 5)),
        ClockKind::Window,
        Some(MissPolicy::Archive),
        None,
    )
    .await;

    let board = load(&app, "2026-01-07T09:00:00").await;
    let lapsed = lifecycle(&board, &root_key(flow_id, day(ymd(2026, 1, 5))));
    assert_eq!(lapsed.resolution, Some(Resolution::Missed));
    assert!(!lapsed.overdue);
    let row = task(&board, &root_key(flow_id, day(ymd(2026, 1, 5)))).unwrap();
    assert!(
        !row.origin.habit().unwrap().iteration_scope.owed,
        "only Window + Owed keeps passed work out of the fold"
    );
}

#[tokio::test]
async fn an_explicit_due_on_an_occurrence_wins_and_is_held_to_its_window() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = habit(
        &app,
        Some("week"),
        week(ymd(2026, 1, 4)),
        ClockKind::Window,
        Some(MissPolicy::Archive),
        None,
    )
    .await;
    let occurrence = root_key(flow_id, week(ymd(2026, 1, 4)));
    let monday = TimeScope::single(day(ymd(2026, 1, 5)));

    let refused = task_commands::update_task(
        app.state(),
        NodeId::Derived(occurrence.id()),
        UpdateTaskRequest {
            due_scope: Some(Some(TimeScope::single(day(ymd(2026, 1, 20))))),
            ..Default::default()
        },
        None,
    )
    .await;
    assert!(
        refused.is_err(),
        "a due outside the occurrence's window is refused"
    );

    task_commands::update_task(
        app.state(),
        NodeId::Derived(occurrence.id()),
        UpdateTaskRequest {
            due_scope: Some(Some(monday.clone())),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();

    let board = load(&app, "2026-01-07T09:00:00").await;
    let row = task(&board, &occurrence).unwrap();
    assert_eq!(
        row.due_scope.map(|due| (due.start_id, due.end_id)),
        Some((monday.start_id, monday.end_id))
    );
    let state = lifecycle(&board, &occurrence);
    assert_eq!(state.timing, Timing::Active, "its week is still open");
    assert!(
        state.overdue,
        "Archive gives it no due of its own, but an explicit one wins"
    );

    task_commands::update_task(
        app.state(),
        NodeId::Derived(occurrence.id()),
        UpdateTaskRequest {
            due_scope: Some(None),
            ..Default::default()
        },
        None,
    )
    .await
    .unwrap();
    let board = load(&app, "2026-01-07T09:00:00").await;
    assert!(
        !lifecycle(&board, &occurrence).overdue,
        "cleared, it is back to none"
    );
}

#[tokio::test]
async fn an_interval_places_its_next_window_the_unit_after_the_completion() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let first = week(ymd(2026, 1, 4));
    let flow_id = habit(&app, Some("week"), first, ClockKind::Interval, None, None).await;

    // Unfinished and past its window: the one open instance, Overdue, and nothing after it.
    let board = load(&app, "2026-01-20T09:00:00").await;
    assert_eq!(roots(&board, flow_id), vec![first]);
    let open = lifecycle(&board, &root_key(flow_id, first));
    assert_eq!(
        (open.timing, open.archival),
        (Timing::Active, Archival::Live)
    );
    assert!(open.overdue, "it stays Overdue past its window");

    // Completed in the week of the 11th: the next is the week of the 18th.
    complete_at(&pool, flow_id, first, "2026-01-14T10:00:00").await;
    let board = load(&app, "2026-01-20T09:00:00").await;
    let next = week(ymd(2026, 1, 18));
    assert_same(roots(&board, flow_id), vec![first, next]);
    assert!(!lifecycle(&board, &root_key(flow_id, next)).overdue);
    assert_eq!(
        lifecycle(&board, &root_key(flow_id, first)).resolution,
        Some(Resolution::Completed)
    );
}

#[tokio::test]
async fn an_unscoped_interval_has_no_window_and_is_never_overdue() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = habit(
        &app,
        None,
        day(ymd(2026, 1, 5)),
        ClockKind::Interval,
        None,
        None,
    )
    .await;
    let first = ScopeKey::exact(at("2026-01-05T02:00:00"), at("2026-01-05T02:00:01")).unwrap();

    let board = load(&app, "2026-03-01T09:00:00").await;
    assert_eq!(roots(&board, flow_id), vec![first]);
    let row = task(&board, &root_key(flow_id, first)).unwrap();
    assert!(
        row.time_scope.is_none(),
        "an unscoped instance has no window"
    );
    assert!(!lifecycle(&board, &root_key(flow_id, first)).overdue);

    // No Gap: the next one is there the moment this one is done.
    complete_at(&pool, flow_id, first, "2026-01-06T10:00:00").await;
    let board = load(&app, "2026-01-06T10:30:00").await;
    let next = ScopeKey::exact(at("2026-01-06T10:00:00"), at("2026-01-06T10:00:01")).unwrap();
    assert_same(roots(&board, flow_id), vec![first, next]);
    let done = lifecycle(&board, &root_key(flow_id, first));
    assert_eq!(
        (done.resolution, done.archival),
        (Some(Resolution::Completed), Archival::Archived),
        "a done instance archives once the next has taken its place"
    );
}
