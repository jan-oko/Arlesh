//! A flow Task item's **Compound** flag and **wait template** (Task 611): what a Habit occurrence
//! reads from its item and may override, how a compound occurrence derives its status and block,
//! and what a plain Flow's `start` copies onto the Task it makes.

use crate::helpers;

use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::flows::{
    model::{
        ClockKind, CreateFlowItemRequest, CreateFlowRequest, InstanceType, MissPolicy,
        SetRecurrenceRequest, StartFlowRequest, UpdateFlowItemRequest,
    },
    template::TemplateUpdate,
};
use arlesh_lib::mindmap::{self, model::MindmapLoad};
use arlesh_lib::nodes::{
    id::NodeId,
    key::{OccurrenceKey, TemplateItem, TemplateKind},
    origin::Origin,
    write,
};
use arlesh_lib::scopes::key::ScopeKey;
use arlesh_lib::tasks::{
    error::TaskError,
    model::{AsyncTemplate, DurationSpec, Task, TaskId, TaskStatus, UpdateTaskRequest},
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

/// A daily-flow request under the root aspect.
fn daily(title: &str) -> CreateFlowRequest {
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

/// A flow Task item under `parent` (the flow, or another item).
async fn item(app: &App, flow_id: i64, title: &str, parent: (&str, i64)) -> i64 {
    flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id,
            title: title.into(),
            parent_type: parent.0.into(),
            parent_id: parent.1,
        },
    )
    .await
    .unwrap()
    .id
}

async fn set_template(app: &App, item: i64, template: TemplateUpdate) {
    flow_commands::update_flow_task(
        app.state(),
        item,
        UpdateFlowItemRequest {
            template,
            ..Default::default()
        },
    )
    .await
    .unwrap();
}

/// The board's Habit: a daily task Habit "Mornings" from 2026-01-05, with one item "Review" whose
/// template says `template`, and one step "File the receipts" beneath it. Returns the flow, the
/// item and the step.
async fn habit(app: &App, template: TemplateUpdate) -> (i64, i64, i64) {
    let flow = flow_commands::create_flow(app.state(), daily("Mornings"))
        .await
        .unwrap();
    let review = item(app, flow.id, "Review", ("flow", flow.id)).await;
    let step = item(app, flow.id, "File the receipts", ("flow_task", review)).await;
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: ScopeKey::day(day()),
            gap_n: None,
            gap_kind: None,
            end_scope_id: None,
            clock: ClockKind::Window,
            miss_policy: Some(MissPolicy::Owed),
        },
    )
    .await
    .unwrap();
    set_template(app, review, template).await;
    (flow.id, review, step)
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

fn of_item(item_id: i64) -> NodeId {
    occurrence(TemplateKind::FlowTask, item_id)
}

/// Serves the board once — which is also what makes the occurrence ids known to the registry.
async fn served(pool: &sqlx::SqlitePool) -> MindmapLoad {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let load = mindmap::load(&mut db, at(NOW)).await.unwrap();
    db.commit().await.unwrap();
    load
}

async fn update(
    pool: &sqlx::SqlitePool,
    id: &NodeId,
    request: UpdateTaskRequest,
) -> Result<Task, arlesh_lib::error::AppError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let written = write::update_task(&mut db, id, request, at(NOW)).await;
    if written.is_ok() {
        db.commit().await.unwrap();
    }
    written
}

fn row(load: &MindmapLoad, id: &NodeId) -> Task {
    load.tasks
        .iter()
        .find(|task| task.id == *id)
        .cloned()
        .expect("the occurrence is on the board")
}

fn compound() -> TemplateUpdate {
    TemplateUpdate {
        compound: Some(true),
        ..Default::default()
    }
}

fn wait(title: &str) -> AsyncTemplate {
    AsyncTemplate {
        title: title.into(),
        tag_ids: Vec::new(),
        time_scope: Some(DurationSpec {
            n: 2,
            kind: "day".into(),
        }),
        check_every: None,
    }
}

fn asynchronous_with(template: AsyncTemplate) -> TemplateUpdate {
    TemplateUpdate {
        asynchronous: Some(true),
        async_template: Some(Some(template)),
        ..Default::default()
    }
}

fn done() -> UpdateTaskRequest {
    UpdateTaskRequest {
        status: Some(TaskStatus::Done),
        ..Default::default()
    }
}

#[tokio::test]
async fn a_compound_items_occurrence_takes_its_status_from_its_steps() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, review, step) = habit(&app, compound()).await;

    let before = row(&served(&pool).await, &of_item(review));
    assert!(before.compound, "it reads Compound from its item");
    assert_eq!(before.status, TaskStatus::Todo.as_str());

    update(&pool, &of_item(step), done()).await.unwrap();

    let after = row(&served(&pool).await, &of_item(review));
    assert_eq!(
        after.status,
        TaskStatus::Done.as_str(),
        "its one step is done"
    );
}

#[tokio::test]
async fn a_compound_occurrence_refuses_a_status_of_its_own() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, review, _) = habit(&app, compound()).await;
    served(&pool).await;

    let refused = update(&pool, &of_item(review), done()).await;

    assert!(
        matches!(
            refused,
            Err(arlesh_lib::error::AppError::Flow(
                arlesh_lib::flows::error::FlowError::Task(TaskError::CompoundOccurrenceStatus)
            ))
        ),
        "{refused:?}"
    );
}

#[tokio::test]
async fn switching_compound_off_on_an_occurrence_keeps_the_status_it_showed() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, review, step) = habit(&app, compound()).await;
    served(&pool).await;
    update(&pool, &of_item(step), done()).await.unwrap();

    update(
        &pool,
        &of_item(review),
        UpdateTaskRequest {
            compound: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let after = row(&served(&pool).await, &of_item(review));
    assert!(!after.compound, "its own flag overrides its item's");
    assert_eq!(
        after.status,
        TaskStatus::Done.as_str(),
        "the derived status, kept"
    );
}

#[tokio::test]
async fn an_occurrence_can_be_made_compound_on_its_own() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, review, step) = habit(&app, TemplateUpdate::default()).await;
    served(&pool).await;

    update(
        &pool,
        &of_item(review),
        UpdateTaskRequest {
            compound: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    update(&pool, &of_item(step), done()).await.unwrap();

    let load = served(&pool).await;
    assert!(row(&load, &of_item(review)).compound);
    assert_eq!(
        row(&load, &of_item(review)).status,
        TaskStatus::Done.as_str()
    );
}

#[tokio::test]
async fn an_iteration_root_cannot_be_made_compound() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (flow, _, _) = habit(&app, TemplateUpdate::default()).await;
    served(&pool).await;

    let refused = update(
        &pool,
        &occurrence(TemplateKind::FlowRoot, flow),
        UpdateTaskRequest {
            compound: Some(true),
            ..Default::default()
        },
    )
    .await;

    assert!(
        matches!(
            refused,
            Err(arlesh_lib::error::AppError::Task(
                TaskError::CompoundOnDerived
            ))
        ),
        "{refused:?}"
    );
}

#[tokio::test]
async fn a_compound_occurrence_whose_open_steps_are_all_blocked_is_blocked() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, review, step) = habit(&app, compound()).await;
    set_template(
        &app,
        step,
        TemplateUpdate {
            block_reasons: Some(vec!["no receipts yet".into()]),
            ..Default::default()
        },
    )
    .await;

    let load = served(&pool).await;

    assert!(
        load.block_reasons
            .iter()
            .any(|reason| reason.owner_id == of_item(review) && reason.derived.is_some()),
        "the derived block reaches the occurrence"
    );
}

#[tokio::test]
async fn an_occurrence_reads_its_items_wait_template() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, review, _) = habit(&app, asynchronous_with(wait("Waiting on the bank"))).await;

    let read = row(&served(&pool).await, &of_item(review));

    assert_eq!(read.async_template, Some(wait("Waiting on the bank")));
}

#[tokio::test]
async fn a_done_occurrence_spawns_its_wait_from_its_items_template() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, review, _) = habit(&app, asynchronous_with(wait("Waiting on the bank"))).await;
    served(&pool).await;

    update(&pool, &of_item(review), done()).await.unwrap();

    let load = served(&pool).await;
    assert!(
        load.expectations.iter().any(|expectation| {
            expectation.title == "Waiting on the bank"
                && matches!(expectation.origin, Origin::SpawnedWait(_))
        }),
        "the wait is drawn from the item's template"
    );
}

#[tokio::test]
async fn an_occurrence_overrides_its_items_wait_template_and_can_drop_it() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, review, _) = habit(&app, asynchronous_with(wait("Waiting on the bank"))).await;
    served(&pool).await;
    let id = of_item(review);

    let own = |template: Option<AsyncTemplate>| UpdateTaskRequest {
        async_template: Some(template),
        ..Default::default()
    };
    update(&pool, &id, own(Some(wait("Waiting on the post"))))
        .await
        .unwrap();
    assert_eq!(
        row(&served(&pool).await, &id).async_template,
        Some(wait("Waiting on the post")),
        "its own"
    );

    update(&pool, &id, own(None)).await.unwrap();
    assert_eq!(
        row(&served(&pool).await, &id).async_template,
        None,
        "emptied, it has none rather than its item's"
    );

    update(&pool, &id, own(Some(wait("Waiting on the bank"))))
        .await
        .unwrap();
    set_template(
        &app,
        review,
        asynchronous_with(wait("Waiting on the clerk")),
    )
    .await;
    assert_eq!(
        row(&served(&pool).await, &id).async_template,
        Some(wait("Waiting on the clerk")),
        "set back to its item's, it follows the item again"
    );
}

#[tokio::test]
async fn switching_an_item_asynchronous_off_drops_its_wait_template() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (_, review, _) = habit(&app, asynchronous_with(wait("Waiting on the bank"))).await;

    set_template(
        &app,
        review,
        TemplateUpdate {
            asynchronous: Some(false),
            ..Default::default()
        },
    )
    .await;
    set_template(
        &app,
        review,
        TemplateUpdate {
            asynchronous: Some(true),
            ..Default::default()
        },
    )
    .await;

    assert_eq!(
        row(&served(&pool).await, &of_item(review)).async_template,
        None
    );
}

#[tokio::test]
async fn only_a_flow_task_item_takes_compound_or_a_wait_template() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), daily("Goals"))
        .await
        .unwrap();
    let goal = flow_commands::create_flow_goal(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Fit".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();

    let refused = flow_commands::update_flow_goal(
        app.state(),
        goal.id,
        UpdateFlowItemRequest {
            template: compound(),
            ..Default::default()
        },
    )
    .await;

    assert!(refused.is_err());
}

#[tokio::test]
async fn starting_a_flow_copies_an_items_compound_flag_and_wait_template() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let flow = flow_commands::create_flow(app.state(), daily("Release"))
        .await
        .unwrap();
    let review = item(&app, flow.id, "Review", ("flow", flow.id)).await;
    let send = item(&app, flow.id, "Send", ("flow", flow.id)).await;
    set_template(&app, review, compound()).await;
    set_template(&app, send, asynchronous_with(wait("Waiting on the reply"))).await;

    flow_commands::start_flow(
        app.state(),
        flow.id,
        StartFlowRequest {
            title: "Release 1".into(),
            target_type: "aspect".into(),
            target_id: 1,
            anchor_date: day(),
        },
    )
    .await
    .unwrap();
    // Edited after the start: nothing already started changes.
    set_template(&app, send, asynchronous_with(wait("Waiting on the editor"))).await;

    let load = served(&pool).await;
    let titled = |title: &str| {
        load.tasks
            .iter()
            .find(|task| task.title == title && task.id.stored().is_some())
            .cloned()
            .expect("the start made it")
    };
    assert!(titled("Review").compound);
    let sent = titled("Send");
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let stored = db
        .tasks()
        .get(TaskId(sent.id.stored().unwrap()))
        .await
        .unwrap();
    assert!(stored.asynchronous);
    assert_eq!(stored.async_template, Some(wait("Waiting on the reply")));
}
