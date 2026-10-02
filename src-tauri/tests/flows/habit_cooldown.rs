//! A Window Habit's cooldown (Task 199), and the done date it counts from.
//!
//! Each test builds a Habit through the commands, completes iterations at chosen instants, and
//! loads the board at a moment to ask whether the next iteration carries the cooldown's block.

use crate::helpers;

use arlesh_lib::block_reasons::model::DerivedBlock;
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
use arlesh_lib::tasks::lifecycle::Archival;
use arlesh_lib::tasks::model::{UpdateCommitmentRequest, Verdict};
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

/// Until when the board says `key`'s root is cooling down — its derived cooldown block — if it is.
fn cooling_until(board: &MindmapLoad, key: &OccurrenceKey) -> Option<chrono::NaiveDateTime> {
    let id = NodeId::Derived(key.id());
    board
        .block_reasons
        .iter()
        .find(|reason| reason.owner_id == id && reason.derived == Some(DerivedBlock::Cooldown))
        .and_then(|reason| reason.until)
}

/// Whether the board draws `key`'s root at all.
fn drawn(board: &MindmapLoad, key: &OccurrenceKey) -> bool {
    let id = NodeId::Derived(key.id());
    board.tasks.iter().any(|task| task.id == id)
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
async fn a_weekly_habit_done_on_saturday_blocks_next_week_through_sunday() {
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
    assert!(
        drawn(&sunday, &next),
        "the week keeps its window, and is drawn"
    );
    assert_eq!(
        cooling_until(&sunday, &next),
        Some(at("2026-09-28T02:00:00")),
        "Sunday is the cooldown: blocked until Monday at the day boundary"
    );
    let reason = sunday
        .block_reasons
        .iter()
        .find(|reason| reason.derived == Some(DerivedBlock::Cooldown))
        .map(|reason| reason.reason.clone());
    assert_eq!(
        reason.as_deref(),
        Some("Cooling down until Mon 2026-09-28 02:00")
    );
    assert_eq!(
        cooling_until(&load(&app, "2026-09-28T01:30:00").await, &next),
        Some(at("2026-09-28T02:00:00"))
    );
    assert_eq!(
        cooling_until(&load(&app, "2026-09-28T02:00:00").await, &next),
        None,
        "the block lifts by itself"
    );
}

#[tokio::test]
async fn completing_the_blocked_iteration_blocks_the_one_after_it() {
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
    complete_at(
        &pool,
        flow_id,
        week(ymd(2026, 9, 27)),
        "2026-10-03T20:00:00",
    )
    .await;
    let blocked = root_key(flow_id, week(ymd(2026, 9, 27)));
    let after = root_key(flow_id, week(ymd(2026, 10, 4)));

    let board = load(&app, "2026-10-04T10:00:00").await;
    assert_eq!(
        cooling_until(&board, &blocked),
        None,
        "done, nothing left to block"
    );
    assert_eq!(
        cooling_until(&board, &after),
        Some(at("2026-10-05T02:00:00"))
    );
}

/// The user's case on the branch instance (2026-10-01): a weekly Habit with a two-day cooldown,
/// W39 (the week of 2026-09-20) completed on Thursday 2026-10-01, inside W40. W40 is blocked from
/// then until its own window's end, on Sunday at 02:00.
#[tokio::test]
async fn a_late_resolution_blocks_the_iteration_already_open() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = flow(&app, "week").await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow_id,
        recurrence(
            week(ymd(2026, 9, 13)),
            ClockKind::Window,
            Some(MissPolicy::Archive),
            Some((2, "day")),
        ),
    )
    .await
    .unwrap();
    let w40 = root_key(flow_id, week(ymd(2026, 9, 27)));
    assert_eq!(
        cooling_until(&load(&app, "2026-10-01T09:00:00").await, &w40),
        None
    );

    complete_at(
        &pool,
        flow_id,
        week(ymd(2026, 9, 20)),
        "2026-10-01T10:00:00",
    )
    .await;
    let board = load(&app, "2026-10-01T10:05:00").await;
    assert!(drawn(&board, &w40));
    assert_eq!(
        cooling_until(&board, &w40),
        Some(at("2026-10-04T02:00:00")),
        "Friday and Saturday are the cooldown"
    );
}

#[tokio::test]
async fn an_overdue_iteration_resolved_late_blocks_the_next() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = flow(&app, "day").await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow_id,
        recurrence(
            ScopeKey::day(ymd(2026, 1, 5)),
            ClockKind::Window,
            Some(MissPolicy::Overdue),
            Some((2, "part")),
        ),
    )
    .await
    .unwrap();
    // The 5th is missed and carried by the 6th, which is done late, at 23:00 in the 6th's Night.
    complete_at(
        &pool,
        flow_id,
        ScopeKey::day(ymd(2026, 1, 6)),
        "2026-01-06T23:00:00",
    )
    .await;
    let board = load(&app, "2026-01-07T03:00:00").await;
    assert_eq!(
        cooling_until(&board, &root_key(flow_id, ScopeKey::day(ymd(2026, 1, 7)))),
        Some(at("2026-01-07T12:00:00")),
        "the Premorning and the Morning are the cooldown; Noon lifts it"
    );
}

/// Window + Owed (ruled 2026-10-01): a cooldown blocks every iteration still open — the owed
/// ones and the current one — until it has passed, and then all lift together.
#[tokio::test]
async fn under_owed_a_completion_blocks_every_open_iteration() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = flow(&app, "week").await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow_id,
        recurrence(
            week(ymd(2026, 9, 13)),
            ClockKind::Window,
            Some(MissPolicy::Owed),
            Some((1, "day")),
        ),
    )
    .await
    .unwrap();
    let first = root_key(flow_id, week(ymd(2026, 9, 13)));
    let caught_up = root_key(flow_id, week(ymd(2026, 9, 20)));
    let current = root_key(flow_id, week(ymd(2026, 9, 27)));
    complete_at(&pool, flow_id, caught_up.iteration, "2026-10-01T10:00:00").await;

    let board = load(&app, "2026-10-01T11:00:00").await;
    for open in [&first, &current] {
        assert!(drawn(&board, open));
        assert_eq!(
            cooling_until(&board, open),
            Some(at("2026-10-03T02:00:00")),
            "{} is blocked until the cooldown has passed",
            open.node_key()
        );
    }
    assert_eq!(cooling_until(&board, &caught_up), None, "done");

    let later = load(&app, "2026-10-03T02:00:00").await;
    for open in [&first, &current] {
        assert_eq!(cooling_until(&later, open), None, "all lift together");
    }
}

/// A weekly Owed Habit with `days` of cooldown from the week of 2026-09-27, done on Friday
/// 2026-10-02. Returns the next week's root.
async fn owed_done_on_friday(app: &App, pool: &sqlx::SqlitePool, days: i64) -> OccurrenceKey {
    let flow_id = flow(app, "week").await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow_id,
        recurrence(
            week(ymd(2026, 9, 27)),
            ClockKind::Window,
            Some(MissPolicy::Owed),
            Some((days, "day")),
        ),
    )
    .await
    .unwrap();
    complete_at(pool, flow_id, week(ymd(2026, 9, 27)), "2026-10-02T18:00:00").await;
    root_key(flow_id, week(ymd(2026, 10, 4)))
}

/// Under Owed, a cooldown begun on Friday also blocks the week that only appears on Sunday: the
/// hold is worked out at every load over the iterations open then. Three days after a Friday
/// completion are Saturday, Sunday and Monday, so the new week is blocked until Tuesday 02:00;
/// two days lift it on Monday at 02:00.
#[tokio::test]
async fn under_owed_a_cooldown_blocks_the_week_that_appears_after_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let three = owed_done_on_friday(&app, &pool, 3).await;
    let two = owed_done_on_friday(&app, &pool, 2).await;

    let saturday = load(&app, "2026-10-03T12:00:00").await;
    assert!(
        !drawn(&saturday, &three),
        "the new week has not appeared yet"
    );

    let sunday = load(&app, "2026-10-04T03:00:00").await;
    assert!(drawn(&sunday, &three));
    assert_eq!(
        cooling_until(&sunday, &three),
        Some(at("2026-10-06T02:00:00"))
    );
    assert_eq!(
        cooling_until(&sunday, &two),
        Some(at("2026-10-05T02:00:00"))
    );

    let monday = load(&app, "2026-10-05T03:00:00").await;
    assert_eq!(
        cooling_until(&monday, &three),
        Some(at("2026-10-06T02:00:00"))
    );
    assert_eq!(
        cooling_until(&monday, &two),
        None,
        "two days lift on Monday"
    );

    let tuesday = load(&app, "2026-10-06T02:00:00").await;
    assert_eq!(
        cooling_until(&tuesday, &three),
        None,
        "three days lift on Tuesday"
    );
}

/// An iteration resolved only because its open work was archived by hand was not done, and
/// starts no cooldown (ruled 2026-10-01: "only done should start the cooldown").
#[tokio::test]
async fn an_iteration_set_aside_by_hand_starts_no_cooldown() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = weekly_with_a_day_of_cooldown(&app).await;
    let first = root_key(flow_id, week(ymd(2026, 9, 20)));
    let next = root_key(flow_id, week(ymd(2026, 9, 27)));
    load(&app, "2026-09-26T19:00:00").await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    arlesh_lib::flows::occurrence_edit::archive(&mut db, &first)
        .await
        .unwrap();
    db.commit().await.unwrap();

    assert_eq!(
        cooling_until(&load(&app, "2026-09-27T10:00:00").await, &next),
        None
    );
}

#[tokio::test]
async fn setting_the_done_date_back_makes_the_cooldown_count_from_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = weekly_with_a_day_of_cooldown(&app).await;
    let first = root_key(flow_id, week(ymd(2026, 9, 20)));
    let next = root_key(flow_id, week(ymd(2026, 9, 27)));
    complete_at(&pool, flow_id, first.iteration, "2026-09-30T10:00:00").await;
    assert_eq!(
        cooling_until(&load(&app, "2026-09-30T11:00:00").await, &next),
        Some(at("2026-10-02T02:00:00")),
        "recorded on Wednesday, the cooldown is Thursday"
    );

    let now = at("2026-09-30T11:00:00");
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
        cooling_until(&load(&app, "2026-09-30T11:00:00").await, &next),
        None,
        "dated back to Saturday, its cooldown was Sunday and is long over"
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
        !refused(recurrence(
            start,
            ClockKind::Window,
            Some(MissPolicy::Owed),
            Some((1, "day"))
        ))
        .await,
        "an owed habit takes one"
    );
    assert!(
        refused(recurrence(
            start,
            ClockKind::Window,
            Some(MissPolicy::Archive),
            Some((7, "day"))
        ))
        .await,
        "a week of cooldown could reach the end of the next week"
    );
    assert!(
        refused(recurrence(
            start,
            ClockKind::Window,
            Some(MissPolicy::Archive),
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

/// A commitment flow under the root aspect, of one `kind` period, with a one-day Verdict Window
/// when `verdict_window` says so.
async fn commitment_flow(app: &App, kind: &str, verdict_window: bool) -> i64 {
    flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Asleep by 23:00".into(),
            instance_type: Some(InstanceType::Commitment),
            parent_type: "aspect".into(),
            parent_id: 1,
            flow_duration_n: Some(1),
            flow_duration_kind: Some(kind.to_string()),
            verdict_window_n: verdict_window.then_some(1),
            verdict_window_kind: verdict_window.then(|| "day".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
}

/// Records `verdict` on the commitment occurrence `key` at `instant`.
async fn give_verdict(
    pool: &sqlx::SqlitePool,
    key: &OccurrenceKey,
    verdict: Verdict,
    instant: &str,
) {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    write::update_commitment(
        &mut db,
        &NodeId::Derived(key.id()),
        UpdateCommitmentRequest {
            verdict: Some(verdict),
            ..Default::default()
        },
        at(instant),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
}

/// Whether the board holds `key`'s root as a Commitment.
fn commitment_drawn(board: &MindmapLoad, key: &OccurrenceKey) -> bool {
    let id = NodeId::Derived(key.id());
    board
        .commitments
        .iter()
        .any(|commitment| commitment.id == id)
}

fn archival(board: &MindmapLoad, key: &OccurrenceKey) -> Archival {
    let id = NodeId::Derived(key.id());
    board
        .lifecycles
        .iter()
        .find(|lifecycle| lifecycle.node_id == id)
        .map(|lifecycle| lifecycle.archival)
        .unwrap_or_else(|| panic!("{} has a lifecycle", key.node_key()))
}

/// An Interval commitment Habit (ruled 2026-10-02): its instance never expires — no Verdict Window
/// applies — and any verdict, Broken included, places the next one after the Gap, counted from the
/// verdict. Clearing the verdict takes the next one away again.
#[tokio::test]
async fn an_interval_commitment_waits_for_its_verdict_and_any_verdict_moves_it_on() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = commitment_flow(&app, "day", true).await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow_id,
        SetRecurrenceRequest {
            gap_n: Some(2),
            gap_kind: Some("day".into()),
            ..recurrence(
                ScopeKey::day(ymd(2026, 1, 5)),
                ClockKind::Interval,
                None,
                None,
            )
        },
    )
    .await
    .unwrap();
    let first = root_key(flow_id, ScopeKey::day(ymd(2026, 1, 5)));
    let next = root_key(flow_id, ScopeKey::day(ymd(2026, 1, 12)));

    let late = load(&app, "2026-01-09T09:00:00").await;
    assert!(commitment_drawn(&late, &first));
    assert_eq!(
        archival(&late, &first),
        Archival::Live,
        "days past its window and its Verdict Window, it has not expired"
    );

    give_verdict(&pool, &first, Verdict::Broken, "2026-01-09T10:00:00").await;
    let board = load(&app, "2026-01-12T03:00:00").await;
    assert!(
        commitment_drawn(&board, &next),
        "broken on the 9th: the 10th and 11th are the Gap, the next falls on the 12th"
    );

    give_verdict(&pool, &first, Verdict::Unresolved, "2026-01-12T04:00:00").await;
    let board = load(&app, "2026-01-12T05:00:00").await;
    assert!(
        !commitment_drawn(&board, &next),
        "cleared, the next is un-placed"
    );
}

/// A Window + Owed commitment Habit with a cooldown: a verdict blocks every iteration still
/// unanswered; a verdict can still be recorded on a blocked one; clearing the verdicts lifts it.
#[tokio::test]
async fn an_owed_commitment_habit_blocks_its_unanswered_iterations_and_still_takes_a_verdict() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow_id = commitment_flow(&app, "week", false).await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow_id,
        recurrence(
            week(ymd(2026, 9, 13)),
            ClockKind::Window,
            Some(MissPolicy::Owed),
            Some((1, "day")),
        ),
    )
    .await
    .unwrap();
    let first = root_key(flow_id, week(ymd(2026, 9, 13)));
    let answered = root_key(flow_id, week(ymd(2026, 9, 20)));
    let current = root_key(flow_id, week(ymd(2026, 9, 27)));
    load(&app, "2026-10-01T09:00:00").await;
    give_verdict(&pool, &answered, Verdict::Kept, "2026-10-01T10:00:00").await;

    let board = load(&app, "2026-10-01T10:30:00").await;
    for open in [&first, &current] {
        assert_eq!(
            cooling_until(&board, open),
            Some(at("2026-10-03T02:00:00")),
            "{} is blocked",
            open.node_key()
        );
    }
    assert_eq!(cooling_until(&board, &answered), None);

    // Recording a verdict stays allowed while blocked.
    give_verdict(&pool, &current, Verdict::Broken, "2026-10-01T11:00:00").await;
    let board = load(&app, "2026-10-01T11:30:00").await;
    assert_eq!(
        cooling_until(&board, &current),
        None,
        "answered, nothing to block"
    );
    assert_eq!(
        cooling_until(&board, &first),
        Some(at("2026-10-03T02:00:00"))
    );

    give_verdict(&pool, &answered, Verdict::Unresolved, "2026-10-01T12:00:00").await;
    give_verdict(&pool, &current, Verdict::Unresolved, "2026-10-01T12:00:00").await;
    let board = load(&app, "2026-10-01T12:30:00").await;
    for open in [&first, &answered, &current] {
        assert_eq!(
            cooling_until(&board, open),
            None,
            "cleared, the cooldown lifts"
        );
    }
}
