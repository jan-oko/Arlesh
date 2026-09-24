//! Writes through the virtual tables that name a Habit occurrence (ADR 0008): children of every
//! kind hung on one, a stored row moved onto one, relations recorded as differences against the
//! template, the template's own fields, and a cycle edit that would orphan what was recorded.
//!
//! Occurrence writes go through `nodes::write` with an explicit instant, so the iteration they
//! name is the one open then rather than whatever the wall clock says.

use crate::helpers;

use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::flows::{
    cycles::Reconcile,
    model::{
        ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowItemType,
        InstanceType, SetRecurrenceRequest, UpdateFlowItemRequest,
    },
    template::TemplateUpdate,
};
use arlesh_lib::infos::model::CreateInfoRequest;
use arlesh_lib::mindmap::{self, model::MindmapLoad};
use arlesh_lib::nodes::{
    id::NodeId,
    key::{OccurrenceKey, TemplateItem, TemplateKind},
    write,
};
use arlesh_lib::scopes::key::ScopeKey;
use arlesh_lib::tasks::model::{
    CreateCommitmentRequest, CreateExpectationRequest, CreateGoalRequest, CreateTaskRequest,
    Dependency, TaskStatus, UpdateTaskRequest,
};
use tauri::Manager;

type App = tauri::App<tauri::test::MockRuntime>;

const NOW: &str = "2026-01-05T09:00:00";

fn at(instant: &str) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(instant, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn day() -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(2026, 1, 5).unwrap()
}

/// A daily task Habit under the root aspect from 2026-01-05, with one item "Stretch".
async fn habit(app: &App) -> (i64, i64) {
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Morning".into(),
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
    .unwrap()
    .id;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: ScopeKey::day(day()),
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

fn occurrence(item_type: TemplateKind, item_id: i64) -> NodeId {
    NodeId::Derived(
        OccurrenceKey {
            item: TemplateItem { item_type, item_id },
            iteration: ScopeKey::day(day()),
            cycle: 0,
        }
        .id(),
    )
}

async fn board(pool: &sqlx::SqlitePool) -> MindmapLoad {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let load = mindmap::load(&mut db, at(NOW)).await.unwrap();
    db.commit().await.unwrap();
    load
}

/// Serves the board once, so the occurrence ids the tests name are known to the registry.
async fn served(pool: &sqlx::SqlitePool) -> MindmapLoad {
    board(pool).await
}

#[tokio::test]
async fn children_of_every_kind_hang_on_an_occurrence() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow, _) = habit(&app).await;
    served(&pool).await;
    let root = occurrence(TemplateKind::FlowRoot, flow);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = write::create_task(
        &mut db,
        CreateTaskRequest {
            title: "Buy milk".into(),
            parent_type: "task".into(),
            parent_id: root.clone(),
            ..Default::default()
        },
        at(NOW),
    )
    .await
    .unwrap();
    let goal = write::create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Stay fit".into(),
            parent_type: "task".into(),
            parent_id: root.clone(),
            ..Default::default()
        },
        at(NOW),
    )
    .await
    .unwrap();
    let commitment = write::create_commitment(
        &mut db,
        CreateCommitmentRequest {
            title: "No sugar".into(),
            parent_type: "task".into(),
            parent_id: root.clone(),
            ..Default::default()
        },
        at(NOW),
    )
    .await
    .unwrap();
    let wait = write::create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Parcel arrives".into(),
            parent_type: "task".into(),
            parent_id: root.clone(),
            ..Default::default()
        },
        at(NOW),
    )
    .await
    .unwrap();
    let note = write::create_info(
        &mut db,
        CreateInfoRequest {
            body: "the blue one".into(),
            details: None,
            parent_type: "task".into(),
            parent_id: root.clone(),
            position: 0,
        },
        at(NOW),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    assert!(
        commitment.time_scope.is_some(),
        "a commitment takes the occurrence's window"
    );
    let load = board(&pool).await;
    let parent_of_task = &load
        .tasks
        .iter()
        .find(|row| row.id == task.id)
        .unwrap()
        .parent_id;
    assert_eq!(parent_of_task, &root);
    let parent_of_goal = &load
        .goals
        .iter()
        .find(|row| row.id == goal.id)
        .unwrap()
        .parent_id;
    assert_eq!(parent_of_goal, &root);
    assert!(load
        .commitments
        .iter()
        .any(|row| row.id == commitment.id && row.parent_id == root));
    assert!(load
        .expectations
        .iter()
        .any(|row| row.id == wait.id && row.parent_id == root));
    assert!(load
        .infos
        .iter()
        .any(|row| row.id == note.id && row.parent_id == root));

    // Marking the occurrence done while its children are open is a question, not a write.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let open = write::unfinished_children(&mut db, &root, at(NOW))
        .await
        .unwrap();
    assert!(open.len() >= 2, "{open:?}");
}

#[tokio::test]
async fn a_stored_task_moved_onto_an_occurrence_hangs_on_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, item) = habit(&app).await;
    served(&pool).await;
    let stretch = occurrence(TemplateKind::FlowTask, item);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let stored = write::create_task(
        &mut db,
        CreateTaskRequest {
            title: "Warm up".into(),
            parent_type: "domain".into(),
            parent_id: 1.into(),
            ..Default::default()
        },
        at(NOW),
    )
    .await
    .unwrap();
    let moved = write::update_task(
        &mut db,
        &stored.id,
        UpdateTaskRequest {
            parent_type: Some("task".into()),
            parent_id: Some(stretch.clone()),
            ..Default::default()
        },
        at(NOW),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    assert_eq!(moved.parent_id, stretch);
    let load = board(&pool).await;
    assert!(load
        .tasks
        .iter()
        .any(|row| row.id == stored.id && row.parent_id == stretch));
}

#[tokio::test]
async fn an_occurrence_takes_tags_block_reasons_and_dependencies_of_its_own() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, item) = habit(&app).await;
    served(&pool).await;
    let stretch = occurrence(TemplateKind::FlowTask, item);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let other = write::create_task(
        &mut db,
        CreateTaskRequest {
            title: "Buy a mat".into(),
            parent_type: "domain".into(),
            parent_id: 1.into(),
            ..Default::default()
        },
        at(NOW),
    )
    .await
    .unwrap();
    write::set_tag(&mut db, "task", &stretch, 1, true, at(NOW))
        .await
        .unwrap();
    write::set_block_reasons(&mut db, "task", &stretch, &["sore".into()], at(NOW))
        .await
        .unwrap();
    write::add_dependency(
        &mut db,
        &stretch,
        Dependency::Task {
            id: other.id.clone(),
        },
        at(NOW),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let load = board(&pool).await;
    let row = load.tasks.iter().find(|row| row.id == stretch).unwrap();
    assert_eq!(row.tag_ids, vec![1]);
    assert!(load
        .block_reasons
        .iter()
        .any(|reason| reason.owner_id == stretch && reason.reason == "sore"));
    assert!(load
        .task_dependencies
        .iter()
        .any(|edge| edge.task_id == stretch && edge.dependency_id == other.id));

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    write::set_tag(&mut db, "task", &stretch, 1, false, at(NOW))
        .await
        .unwrap();
    write::set_block_reasons(&mut db, "task", &stretch, &[], at(NOW))
        .await
        .unwrap();
    write::remove_dependency(
        &mut db,
        &stretch,
        Dependency::Task {
            id: other.id.clone(),
        },
        at(NOW),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    let load = board(&pool).await;
    let row = load.tasks.iter().find(|row| row.id == stretch).unwrap();
    assert!(row.tag_ids.is_empty());
    assert!(!load
        .task_dependencies
        .iter()
        .any(|edge| edge.task_id == stretch));
}

#[tokio::test]
async fn a_template_items_fields_reach_every_occurrence_until_one_says_otherwise() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow, item) = habit(&app).await;
    flow_commands::update_flow_task(
        app.state(),
        item,
        UpdateFlowItemRequest {
            template: TemplateUpdate {
                tag_ids: Some(vec![1]),
                block_reasons: Some(vec!["needs a mat".into()]),
                asynchronous: Some(true),
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let stretch = occurrence(TemplateKind::FlowTask, item);
    let load = served(&pool).await;
    let row = load.tasks.iter().find(|row| row.id == stretch).unwrap();
    assert_eq!(row.tag_ids, vec![1]);
    assert!(row.asynchronous);
    assert!(load
        .block_reasons
        .iter()
        .any(|reason| reason.owner_id == stretch && reason.reason == "needs a mat"));

    // Taking the template's tag off this one occurrence is a difference, not a template edit.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    write::set_tag(&mut db, "task", &stretch, 1, false, at(NOW))
        .await
        .unwrap();
    db.commit().await.unwrap();
    let load = board(&pool).await;
    assert!(load
        .tasks
        .iter()
        .find(|row| row.id == stretch)
        .unwrap()
        .tag_ids
        .is_empty());

    // A copy of the Habit is a Habit with the same template fields.
    let copy = flow_commands::duplicate_flow(app.state(), flow, "aspect".into(), 1, 9)
        .await
        .unwrap();
    let items = flow_commands::list_flow_tasks(app.state(), copy.id)
        .await
        .unwrap();
    assert_eq!(items[0].template.tag_ids, vec![1]);
}

#[tokio::test]
async fn a_cycle_edit_that_would_orphan_a_recorded_edit_asks_first() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow, item) = habit(&app).await;
    let pair = |index| FlowCycleInput {
        scope_kind: Some("part_of_day".into()),
        scope_index: Some(index),
        plan_kind: None,
        plan_start: None,
        plan_end: None,
    };
    flow_commands::set_flow_item_cycles(
        app.state(),
        flow,
        FlowItemType::FlowTask,
        item,
        vec![pair(1)],
        None,
        None,
    )
    .await
    .unwrap();
    let load = served(&pool).await;
    let morning = load
        .tasks
        .iter()
        .find(|row| {
            row.origin.habit().is_some_and(|origin| {
                origin.item_type == TemplateKind::FlowTask && origin.item_id == item
            })
        })
        .unwrap()
        .id
        .clone();
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    write::update_task(
        &mut db,
        &morning,
        UpdateTaskRequest {
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
        at(NOW),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let refused = flow_commands::set_flow_item_cycles(
        app.state(),
        flow,
        FlowItemType::FlowTask,
        item,
        vec![pair(4)],
        None,
        None,
    )
    .await
    .expect_err("dropping the morning pair would orphan its completion");
    assert_eq!(
        serde_json::to_value(&refused).unwrap()["kind"],
        "needs_confirmation"
    );

    let forked = flow_commands::set_flow_item_cycles(
        app.state(),
        flow,
        FlowItemType::FlowTask,
        item,
        vec![pair(4)],
        Some(Reconcile::Fork),
        Some(at(NOW)),
    )
    .await
    .unwrap();
    assert!(forked.is_some(), "Archive & new lands the edit on a copy");
}

/// A plain (non-recurring) flow whose one task item carries a tag and a block reason of its own.
async fn plain_flow_with_template(app: &App) -> (i64, i64) {
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Release".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "aspect".into(),
            parent_id: 1,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let item = flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Tag the build".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap()
    .id;
    flow_commands::update_flow_task(
        app.state(),
        item,
        UpdateFlowItemRequest {
            template: TemplateUpdate {
                tag_ids: Some(vec![1]),
                block_reasons: Some(vec!["waits on CI".into()]),
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .await
    .unwrap();
    (flow.id, item)
}

#[tokio::test]
async fn starting_a_flow_gives_its_copies_the_template_fields() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow, _) = plain_flow_with_template(&app).await;
    flow_commands::start_flow(
        app.state(),
        flow,
        arlesh_lib::flows::model::StartFlowRequest {
            title: "Ship it".into(),
            target_type: "aspect".into(),
            target_id: 1,
            anchor_date: day(),
        },
    )
    .await
    .unwrap();
    let load = board(&pool).await;
    let copy = load
        .tasks
        .iter()
        .find(|task| task.title == "Tag the build")
        .expect("the item was started as a Task");
    assert_eq!(copy.tag_ids, vec![1]);
    assert!(load
        .block_reasons
        .iter()
        .any(|reason| reason.owner_id == copy.id && reason.reason == "waits on CI"));
}

#[tokio::test]
async fn a_copied_flow_item_keeps_its_template_fields_and_a_deleted_one_leaves_none() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow, item) = plain_flow_with_template(&app).await;
    flow_commands::duplicate_flow_item(
        app.state(),
        FlowItemType::FlowTask,
        item,
        "flow".into(),
        flow,
        5,
    )
    .await
    .unwrap();
    let items = flow_commands::list_flow_tasks(app.state(), flow)
        .await
        .unwrap();
    assert_eq!(items.len(), 2);
    assert!(items.iter().all(|item| item.template.tag_ids == vec![1]
        && item.template.block_reasons == vec!["waits on CI".to_string()]));

    for item in &items {
        flow_commands::delete_flow_item(app.state(), FlowItemType::FlowTask, item.id)
            .await
            .unwrap();
    }
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM template_tags")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0, "a deleted item's template rows go with it");
}
