//! Editing a Habit item's cycle pairs without losing what was recorded against its occurrences.
//!
//! A pair's id is part of every occurrence's identity, so saving an item used to orphan every
//! status and every per-occurrence edit on it — even a save that only renamed it. These tests hold
//! the item editor's save to its promise: pairs that survive keep their ids, and a change that
//! would still orphan something asks the Habit editor's question first.

use crate::helpers;

use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::flows::model::{
    ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowItemType,
    HabitInstanceRef, InstanceType, SetRecurrenceRequest, UpdateFlowItemRequest,
};
use arlesh_lib::flows::occurrence::Reconcile;
use arlesh_lib::scopes::model::ScopeKind;
use tauri::Manager;

type App = tauri::App<tauri::test::MockRuntime>;

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

/// The `part`-th part of the day, planned (or not) on the same part.
fn pair(part: i64, planned: bool) -> FlowCycleInput {
    FlowCycleInput {
        scope_kind: Some("part_of_day".into()),
        scope_index: Some(part),
        plan_kind: planned.then(|| "part_of_day".into()),
        plan_start: planned.then_some(1),
        plan_end: planned.then_some(1),
    }
}

/// A daily Habit whose one task, "Stretch", has a morning and an evening pair — and the anchor of
/// its first day, and the two pair ids.
struct Stretch {
    flow_id: i64,
    item_id: i64,
    monday: i64,
    morning: i64,
    evening: i64,
}

async fn cycle_ids(pool: &sqlx::SqlitePool, item_id: i64) -> Vec<i64> {
    sqlx::query_scalar(
        "SELECT id FROM flow_item_cycles WHERE item_type = 'flow_task' AND item_id = ? \
         ORDER BY position",
    )
    .bind(item_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn stretch(pool: &sqlx::SqlitePool, app: &App) -> Stretch {
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Routine".into(),
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
    save_cycles(
        app,
        flow.id,
        item.id,
        vec![pair(1, false), pair(4, false)],
        None,
    )
    .await
    .unwrap();
    let monday = helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .scopes()
        .get_or_create(ScopeKind::Day, ymd(2026, 1, 5))
        .await
        .unwrap()
        .id;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: monday,
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
    let ids = cycle_ids(pool, item.id).await;
    Stretch {
        flow_id: flow.id,
        item_id: item.id,
        monday,
        morning: ids[0],
        evening: ids[1],
    }
}

async fn save_cycles(
    app: &App,
    flow_id: i64,
    item_id: i64,
    cycles: Vec<FlowCycleInput>,
    reconcile: Option<Reconcile>,
) -> Result<Option<arlesh_lib::flows::occurrence::ForkedTemplate>, arlesh_lib::error::WireError> {
    flow_commands::set_flow_item_cycles(
        app.state(),
        flow_id,
        FlowItemType::FlowTask,
        item_id,
        cycles,
        reconcile,
    )
    .await
}

impl Stretch {
    fn evening_occurrence(&self) -> HabitInstanceRef {
        HabitInstanceRef {
            item_type: "flow_task".into(),
            item_id: self.item_id,
            iteration_scope_id: self.monday,
            cycle_id: self.evening,
        }
    }

    /// Records a completion and an own title on Monday evening's occurrence.
    async fn record_monday_evening(&self, app: &App) {
        flow_commands::set_habit_item_status(
            app.state(),
            self.flow_id,
            self.evening_occurrence(),
            Some("done".into()),
            1_767_600_000_000,
            None,
        )
        .await
        .unwrap();
        flow_commands::set_habit_instance_title(
            app.state(),
            self.flow_id,
            self.evening_occurrence(),
            Some("Stretch before bed".into()),
        )
        .await
        .unwrap();
    }

    /// How many Modification rows Monday evening's occurrence still has on its own pair.
    async fn evening_records(&self, pool: &sqlx::SqlitePool) -> i64 {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM habit_instance_modifications
             WHERE item_id = ? AND cycle_id = ? AND status = 'done'
               AND title = 'Stretch before bed'",
        )
        .bind(self.item_id)
        .bind(self.evening)
        .fetch_one(pool)
        .await
        .unwrap()
    }
}

#[tokio::test]
async fn a_title_only_save_of_the_item_keeps_every_recorded_edit() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = stretch(&pool, &app).await;
    habit.record_monday_evening(&app).await;

    // What the item editor's save sends: the new title, then the pairs exactly as they were.
    flow_commands::update_flow_task(
        app.state(),
        habit.item_id,
        UpdateFlowItemRequest {
            title: Some("Stretch well".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    save_cycles(
        &app,
        habit.flow_id,
        habit.item_id,
        vec![pair(1, false), pair(4, false)],
        None,
    )
    .await
    .expect("an unchanged set of pairs has nothing to ask about");

    assert_eq!(
        cycle_ids(&pool, habit.item_id).await,
        vec![habit.morning, habit.evening]
    );
    assert_eq!(habit.evening_records(&pool).await, 1);
}

#[tokio::test]
async fn a_plan_only_change_keeps_the_pair_and_what_was_recorded_on_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = stretch(&pool, &app).await;
    habit.record_monday_evening(&app).await;

    save_cycles(
        &app,
        habit.flow_id,
        habit.item_id,
        vec![pair(1, false), pair(4, true)],
        None,
    )
    .await
    .expect("a Cycle Plan change keeps the occurrence, so it orphans nothing");

    assert_eq!(
        cycle_ids(&pool, habit.item_id).await,
        vec![habit.morning, habit.evening]
    );
    assert_eq!(habit.evening_records(&pool).await, 1);
}

#[tokio::test]
async fn removing_a_pair_with_recorded_edits_asks_first_and_changes_nothing() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = stretch(&pool, &app).await;
    habit.record_monday_evening(&app).await;

    let refused = save_cycles(
        &app,
        habit.flow_id,
        habit.item_id,
        vec![pair(1, false)],
        None,
    )
    .await
    .expect_err("the evening pair holds a completion and a title");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(wire["kind"].as_str(), Some("needs_confirmation"));
    assert_eq!(
        wire["details"]["reason"].as_str(),
        Some("orphans_occurrence_edits")
    );
    assert_eq!(wire["details"]["count"].as_i64(), Some(1));

    assert_eq!(
        cycle_ids(&pool, habit.item_id).await,
        vec![habit.morning, habit.evening]
    );
    assert_eq!(habit.evening_records(&pool).await, 1);
}

#[tokio::test]
async fn removing_a_pair_nothing_was_recorded_on_needs_no_question() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = stretch(&pool, &app).await;

    save_cycles(
        &app,
        habit.flow_id,
        habit.item_id,
        vec![pair(1, false)],
        None,
    )
    .await
    .expect("nothing hangs on the evening pair");

    assert_eq!(cycle_ids(&pool, habit.item_id).await, vec![habit.morning]);
}

#[tokio::test]
async fn discard_clears_the_habits_recorded_edits_and_saves_the_pairs() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = stretch(&pool, &app).await;
    habit.record_monday_evening(&app).await;

    save_cycles(
        &app,
        habit.flow_id,
        habit.item_id,
        vec![pair(1, false)],
        Some(Reconcile::Discard),
    )
    .await
    .unwrap();

    assert_eq!(cycle_ids(&pool, habit.item_id).await, vec![habit.morning]);
    assert_eq!(
        flow_commands::habit_completion_count(app.state(), habit.flow_id)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn archive_and_new_lands_the_change_on_a_fork_and_leaves_the_original_whole() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let habit = stretch(&pool, &app).await;
    habit.record_monday_evening(&app).await;

    let fork = save_cycles(
        &app,
        habit.flow_id,
        habit.item_id,
        vec![pair(1, false)],
        Some(Reconcile::Fork),
    )
    .await
    .unwrap()
    .expect("a fork says where the change went");

    assert_ne!(fork.flow_id, habit.flow_id);
    assert_eq!(
        cycle_ids(&pool, habit.item_id).await,
        vec![habit.morning, habit.evening],
        "the original keeps its pairs"
    );
    assert_eq!(habit.evening_records(&pool).await, 1, "and its history");
    let forked_item = fork
        .tasks
        .iter()
        .find(|(old, _)| *old == habit.item_id)
        .map(|(_, new)| *new)
        .unwrap();
    assert_eq!(cycle_ids(&pool, forked_item).await.len(), 1);
    assert!(
        flow_commands::get_flow_recurrence(app.state(), fork.flow_id)
            .await
            .unwrap()
            .is_some(),
        "the fork is a Habit too — the item editor does not restate the Recurrence"
    );
}
