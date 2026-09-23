//! Children hung on one Habit occurrence and no other.
//!
//! An occurrence had nowhere to put anything: work specific to tonight's run either went into the
//! template, where it recurs forever, or into a sibling Task with no link to the occurrence it
//! belonged to. These are the behaviours that make the third option real — and, as much, the ones
//! that keep it from leaking into everything else: iteration resolution is untouched, the guard is
//! a question and not a wall, and nothing about the template ever changes.
//!
//! Every test here asks a behavioural question — does this iteration resolve, is this write
//! refused, what does this occurrence carry — rather than which rows exist. The one exception is
//! the template-untouched assertion, where row absence *is* the behaviour.

use crate::helpers;

use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::commands::tasks as task_commands;
use arlesh_lib::flows::model::{
    BlockingMode, CatchupPolicy, ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, FlowId,
    HabitInstanceChild, InstanceType, SetRecurrenceRequest, TargetRef,
};
use arlesh_lib::nodes::id::NodeId;
use arlesh_lib::nodes::key::{OccurrenceKey, TemplateItem, TemplateKind};
use arlesh_lib::scopes::model::ScopeKind;
use arlesh_lib::tasks::model::{Task, TaskId, TaskStatus, TimeScope, UpdateTaskRequest};
use helpers::StoredId;
use tauri::Manager;

fn ymd(y: i32, m: u32, d: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

/// A day-long Habit under the fixed root aspect, so one iteration is one day.
fn daily_habit(title: &str) -> CreateFlowRequest {
    CreateFlowRequest {
        title: title.into(),
        instance_type: Some(InstanceType::Task),
        parent_type: "aspect".into(),
        parent_id: 1,
        flow_duration_n: Some(1),
        flow_duration_kind: Some("day".into()),
        ..Default::default()
    }
}

/// Mints the canonical scope a date falls in, as the iteration anchor an occurrence keys on.
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

/// The flow root's occurrence in the Habit's first iteration, 2026-01-05.
fn root_of(flow_id: i64) -> OccurrenceKey {
    OccurrenceKey {
        item: TemplateItem {
            item_type: TemplateKind::FlowRoot,
            item_id: flow_id,
        },
        iteration: ymd(2026, 1, 5),
        cycle: 0,
    }
}

/// Hangs a new node of `kind` on one occurrence.
async fn add_child(
    pool: &sqlx::SqlitePool,
    parent: &OccurrenceKey,
    kind: &str,
    title: &str,
) -> Result<TargetRef, arlesh_lib::flows::error::FlowError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let child = arlesh_lib::flows::create_instance_child(&mut db, parent, kind, title.into()).await;
    if child.is_ok() {
        db.commit().await.unwrap();
    }
    child
}

/// Completes the Habit's first iteration root through the ordinary Task update.
async fn complete_root(
    app: &tauri::App<tauri::test::MockRuntime>,
    flow_id: i64,
    confirmed: Option<bool>,
) -> Result<Task, arlesh_lib::error::WireError> {
    task_commands::update_task(
        app.state(),
        NodeId::Derived(root_of(flow_id).id()),
        UpdateTaskRequest {
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
        confirmed,
    )
    .await
}

/// The iteration root's status as the board reads it.
async fn root_status(app: &tauri::App<tauri::test::MockRuntime>, flow_id: i64) -> String {
    let load = arlesh_lib::commands::mindmap::load_mindmap(app.state(), at("2026-01-05T09:00:00"))
        .await
        .unwrap();
    let root = NodeId::Derived(root_of(flow_id).id());
    load.tasks
        .into_iter()
        .find(|task| task.id == root)
        .expect("the iteration root is on the board")
        .status
}

/// Every node hung on this Habit's occurrences.
async fn children(pool: &sqlx::SqlitePool, flow_id: i64) -> Vec<HabitInstanceChild> {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .list_instance_children(FlowId(flow_id))
        .await
        .unwrap()
}

fn at(instant: &str) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(instant, "%Y-%m-%dT%H:%M:%S").unwrap()
}

/// A day-long Habit starting 2026-01-05, and the anchor scope of its first iteration.
async fn habit_with_one_day(
    pool: &sqlx::SqlitePool,
    app: &tauri::App<tauri::test::MockRuntime>,
) -> (i64, i64) {
    let flow = flow_commands::create_flow(app.state(), daily_habit("Groceries"))
        .await
        .unwrap();
    let start = scope_id(pool, ScopeKind::Day, ymd(2026, 1, 5)).await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: start,
            gap_n: None,
            gap_kind: None,
            end_scope_id: None,
            consumption_kind: ConsumptionKind::Accumulating,
            blocking_mode: Some(BlockingMode::Blocking),
            catchup_policy: Some(CatchupPolicy::Next),
        },
    )
    .await
    .unwrap();
    (flow.id, start)
}

#[tokio::test]
async fn an_occurrence_takes_a_child_of_every_kind_a_task_can_parent() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;

    for kind in ["task", "goal", "commitment", "info"] {
        let child = add_child(&pool, &root_of(flow_id), kind, &format!("a {kind}"))
            .await
            .unwrap_or_else(|error| panic!("an occurrence should hold a {kind}: {error:?}"));
        assert_eq!(child.node_type, kind);
    }

    let children = children(&pool, flow_id).await;
    assert_eq!(
        children.len(),
        4,
        "all four kinds hang on the occurrence — anything a Task can parent"
    );
    assert!(
        children
            .iter()
            .all(|c| c.parent_key == root_of(flow_id).node_key()),
        "each one belongs to the iteration it was added on, and to no other"
    );
}

#[tokio::test]
async fn a_flow_or_a_flow_item_is_refused_by_name() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;

    let refused = add_child(&pool, &root_of(flow_id), "flow", "nested habit")
        .await
        .expect_err("an occurrence holds what a Task holds, and a Flow is not among them");
    let wire = serde_json::to_value(arlesh_lib::error::WireError::from_error(refused)).unwrap();
    assert_eq!(wire["kind"].as_str(), Some("invalid_request"));
}

#[tokio::test]
async fn an_unfinished_child_never_withholds_the_habits_next_iteration() {
    // The highest-value test in the feature, and a negative one: under Blocking consumption an
    // unresolved iteration withholds every iteration after it. Added children are not instances,
    // so an occurrence carrying one must resolve exactly as it would without it — otherwise
    // something jotted against tonight could stall the habit forever.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    // The occurrence is closed over the unfinished child, deliberately.
    complete_root(&app, flow_id, Some(true)).await.unwrap();

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let iterations = arlesh_lib::flows::generate_habit_iterations(
        &mut db,
        FlowId(flow_id),
        at("2026-01-07T09:00:00"),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    assert!(
        iterations.len() > 1,
        "the resolved iteration released the next one; an added child gates nothing"
    );
}

#[tokio::test]
async fn completing_an_occurrence_that_still_holds_work_asks_first_and_names_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    let refusal = complete_root(&app, flow_id, None)
        .await
        .expect_err("an occurrence still holding work is not closed without being asked");

    let wire = serde_json::to_value(&refusal).unwrap();
    assert_eq!(wire["kind"].as_str(), Some("needs_confirmation"));
    let details = serde_json::to_string(&wire["details"]).unwrap();
    assert!(
        details.contains("buy milk"),
        "the refusal names what is about to be closed over, so the answer is not blind: {details}"
    );

    assert_eq!(
        root_status(&app, flow_id).await,
        "todo",
        "declining leaves the occurrence exactly as it was"
    );
}

#[tokio::test]
async fn confirming_closes_the_occurrence_and_leaves_the_child_alone() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    let child = add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    complete_root(&app, flow_id, Some(true)).await.unwrap();

    assert_eq!(
        root_status(&app, flow_id).await,
        "done",
        "the occurrence is done"
    );
    let still_there = children(&pool, flow_id).await;
    assert_eq!(
        still_there.first().map(|c| c.child_id),
        Some(child.node_id),
        "the child stays where it was — 'done anyway' discards nothing"
    );
}

#[tokio::test]
async fn a_finished_child_raises_no_prompt_at_all() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    let child = add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    arlesh_lib::tasks::update_task(
        &mut db,
        TaskId(child.node_id),
        UpdateTaskRequest {
            status: Some(arlesh_lib::tasks::model::TaskStatus::Done),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    complete_root(&app, flow_id, None)
        .await
        .expect("nothing is unfinished, so there is nothing to ask about");
}

#[tokio::test]
async fn a_note_on_an_occurrence_is_never_unfinished_work() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    add_child(
        &pool,
        &root_of(flow_id),
        "info",
        "the corner shop shuts at 8",
    )
    .await
    .unwrap();

    complete_root(&app, flow_id, None)
        .await
        .expect("a note is not work, and is no reason to stop and ask");
}

#[tokio::test]
async fn a_childs_window_must_sit_inside_the_occurrences() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, start) = habit_with_one_day(&pool, &app).await;
    let child = add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    // The occurrence runs over 2026-01-05 alone, so the following day escapes it.
    let outside = scope_id(&pool, ScopeKind::Day, ymd(2026, 1, 6)).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let refused = arlesh_lib::tasks::update_task(
        &mut db,
        TaskId(child.node_id),
        UpdateTaskRequest {
            time_scope: Some(Some(TimeScope {
                start_id: outside,
                end_id: outside,
                duration: None,
            })),
            ..Default::default()
        },
    )
    .await;
    assert!(
        refused.is_err(),
        "containment holds here as everywhere: a child cannot outrun the occurrence it hangs on"
    );
    drop(db);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    arlesh_lib::tasks::update_task(
        &mut db,
        TaskId(child.node_id),
        UpdateTaskRequest {
            time_scope: Some(Some(TimeScope {
                start_id: start,
                end_id: start,
                duration: None,
            })),
            ..Default::default()
        },
    )
    .await
    .expect("the occurrence's own day is inside it");
    db.commit().await.unwrap();
}

#[tokio::test]
async fn an_added_child_makes_its_occurrence_divergent() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    assert_eq!(
        flow_commands::habit_completion_count(app.state(), flow_id)
            .await
            .unwrap(),
        0
    );

    add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    assert_eq!(
        flow_commands::habit_completion_count(app.state(), flow_id)
            .await
            .unwrap(),
        1,
        "editing the habit now prompts instead of silently regenerating over the child"
    );
}

#[tokio::test]
async fn delete_and_regenerate_takes_the_added_children_with_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    let child = add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    flow_commands::clear_habit_modifications(app.state(), flow_id)
        .await
        .unwrap();

    assert!(
        children(&pool, flow_id).await.is_empty(),
        "the instances they hung off are gone, so nothing is left dangling"
    );
    let task: Option<i64> = sqlx::query_scalar("SELECT id FROM tasks WHERE id = ?")
        .bind(child.node_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(
        task.is_none(),
        "the row goes too — the prompt is what warned about this"
    );
}

#[tokio::test]
async fn deleting_an_added_child_never_reaches_the_template() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id,
            title: "Walk there".into(),
            parent_type: "flow".into(),
            parent_id: flow_id,
        },
    )
    .await
    .unwrap();
    let child = add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    arlesh_lib::tasks::delete_task(&mut db, TaskId(child.node_id))
        .await
        .unwrap();
    db.commit().await.unwrap();

    let template = flow_commands::list_flow_tasks(app.state(), flow_id)
        .await
        .unwrap();
    assert_eq!(
        template.len(),
        1,
        "the template is untouched by anything done to a child"
    );
    assert!(
        children(&pool, flow_id).await.is_empty(),
        "and the attachment goes with the row, so a recycled id cannot inherit it"
    );
}

#[tokio::test]
async fn a_child_archives_with_the_occurrence_whose_window_has_passed() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    let child = add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let inside = arlesh_lib::tasks::derive_all_scope_lifecycles(
        &mut db,
        chrono::NaiveDateTime::parse_from_str("2026-01-05T09:00:00", "%Y-%m-%dT%H:%M:%S").unwrap(),
    )
    .await
    .unwrap();
    let after = arlesh_lib::tasks::derive_all_scope_lifecycles(
        &mut db,
        chrono::NaiveDateTime::parse_from_str("2026-02-01T09:00:00", "%Y-%m-%dT%H:%M:%S").unwrap(),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let archival = |lifecycles: &[arlesh_lib::tasks::lifecycle::ItemLifecycle]| {
        lifecycles
            .iter()
            .find(|l| l.node_type == "task" && l.node_id == child.node_id)
            .map(|l| format!("{:?}", l.archival))
            .unwrap()
    };
    assert_eq!(
        archival(&inside),
        "Live",
        "the occurrence's day is still open"
    );
    assert_eq!(
        archival(&after),
        "Archived",
        "and once its window passes the occurrence archives as a unit, children and all"
    );
}

#[tokio::test]
async fn an_added_child_holds_children_of_its_own_in_the_ordinary_way() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow_id, _start) = habit_with_one_day(&pool, &app).await;
    let child = add_child(&pool, &root_of(flow_id), "task", "buy milk")
        .await
        .unwrap();

    // Minted before the session opens: the test pool lends one connection, and a query taken while
    // a session holds it waits for sqlx's default timeout instead of running.
    let outside = scope_id(&pool, ScopeKind::Day, ymd(2026, 1, 6)).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let nested = arlesh_lib::tasks::create_task(
        &mut db,
        arlesh_lib::tasks::model::CreateTaskRequest {
            title: "check the fridge first".into(),
            parent_type: "task".into(),
            parent_id: child.node_id,
            status: None,
            time_scope: None,
            on_scope_exit: None,
            plan: None,
            archival: None,
            agentic: None,
            asynchronous: None,
            async_template: None,
        },
    )
    .await
    .expect("a step with sub-steps is expressible");
    // The occurrence's window governs two levels down as well, so the nested step cannot outrun it
    // either — the chain climbs through the added child into the occurrence, as it does for the
    // child itself.
    let refused = arlesh_lib::tasks::update_task(
        &mut db,
        TaskId(nested.id.sid()),
        UpdateTaskRequest {
            time_scope: Some(Some(TimeScope {
                start_id: outside,
                end_id: outside,
                duration: None,
            })),
            ..Default::default()
        },
    )
    .await;
    assert!(
        refused.is_err(),
        "the occurrence governs its whole subtree, not just its first level"
    );
    drop(db);

    assert_eq!(
        children(&pool, flow_id).await.len(),
        1,
        "only the first level is attached; everything under it is an ordinary parent link"
    );
}
