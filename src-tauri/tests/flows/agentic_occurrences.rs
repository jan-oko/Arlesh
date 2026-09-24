//! The agentic brief through templates and occurrences (Arlesh-cz2 over ADR 0008): a template's
//! brief read by every occurrence, an occurrence overriding it field by field, the Spec rule on an
//! agentic occurrence, and agentic waits hung on one.

use crate::helpers;

use arlesh_lib::commands::flows as flow_commands;
use arlesh_lib::flows::{
    model::{
        BlockingMode, ConsumptionKind, CreateFlowItemRequest, CreateFlowRequest, InstanceType,
        SetRecurrenceRequest, UpdateFlowItemRequest,
    },
    template::TemplateUpdate,
};
use arlesh_lib::mindmap::{self, model::MindmapLoad};
use arlesh_lib::nodes::{
    id::NodeId,
    key::{OccurrenceKey, TemplateItem, TemplateKind},
    write,
};
use arlesh_lib::scopes::key::ScopeKey;
use arlesh_lib::tasks::model::{
    AgenticBrief, CreateExpectationRequest, TaskAgentic, TaskStatus, UpdateTaskRequest,
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

/// A daily task Habit under the root aspect from 2026-01-05, with one item "Tidy the inbox" whose
/// template says `template`.
async fn habit(app: &App, template: TemplateUpdate) -> i64 {
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Mornings".into(),
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
            title: "Tidy the inbox".into(),
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
            blocking_mode: Some(BlockingMode::Overlapping),
            catchup_policy: None,
        },
    )
    .await
    .unwrap();
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
    item
}

fn occurrence(item_id: i64) -> NodeId {
    NodeId::Derived(
        OccurrenceKey {
            item: TemplateItem {
                item_type: TemplateKind::FlowTask,
                item_id,
            },
            iteration: ScopeKey::day(day()),
            cycle: 0,
        }
        .id(),
    )
}

/// Serves the board once — which is also what makes the occurrence ids known to the registry.
async fn served(pool: &sqlx::SqlitePool) -> MindmapLoad {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let load = mindmap::load(&mut db, at(NOW)).await.unwrap();
    db.commit().await.unwrap();
    load
}

fn brief(spec: &str) -> AgenticBrief {
    AgenticBrief {
        priority: Some(1),
        spec: spec.into(),
        design: "Oldest first".into(),
        acceptance: "Inbox zero".into(),
        notes: String::new(),
    }
}

fn agentic_with(brief: Option<AgenticBrief>) -> TemplateUpdate {
    TemplateUpdate {
        agentic: Some(TaskAgentic::Yes),
        agentic_brief: Some(brief),
        ..Default::default()
    }
}

async fn update(
    pool: &sqlx::SqlitePool,
    id: &NodeId,
    request: UpdateTaskRequest,
) -> Result<arlesh_lib::tasks::model::Task, arlesh_lib::error::AppError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let written = write::update_task(&mut db, id, request, at(NOW)).await;
    if written.is_ok() {
        db.commit().await.unwrap();
    }
    written
}

fn row(load: &MindmapLoad, id: &NodeId) -> arlesh_lib::tasks::model::Task {
    load.tasks
        .iter()
        .find(|task| task.id == *id)
        .cloned()
        .expect("the occurrence is on the board")
}

#[tokio::test]
async fn an_occurrence_reads_its_templates_brief() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let item = habit(&app, agentic_with(Some(brief("Sort the mail")))).await;

    let load = served(&pool).await;

    assert_eq!(
        row(&load, &occurrence(item)).agentic_brief,
        Some(brief("Sort the mail"))
    );
}

#[tokio::test]
async fn an_occurrence_overrides_one_field_and_keeps_reading_the_rest() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let item = habit(&app, agentic_with(Some(brief("Sort the mail")))).await;
    served(&pool).await;
    let tidy = occurrence(item);

    update(
        &pool,
        &tidy,
        UpdateTaskRequest {
            agentic_brief: Some(Some(AgenticBrief {
                spec: "Sort the mail, and the parcels".into(),
                ..brief("Sort the mail")
            })),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    flow_commands::update_flow_task(
        app.state(),
        item,
        UpdateFlowItemRequest {
            template: TemplateUpdate {
                agentic_brief: Some(Some(AgenticBrief {
                    design: "Newest first".into(),
                    ..brief("Sort the mail")
                })),
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let read = row(&served(&pool).await, &tidy)
        .agentic_brief
        .expect("the occurrence has a brief");
    assert_eq!(read.spec, "Sort the mail, and the parcels", "its own");
    assert_eq!(read.design, "Newest first", "still its template's");
}

#[tokio::test]
async fn an_agentic_occurrence_without_a_spec_cannot_start() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let item = habit(&app, agentic_with(None)).await;
    served(&pool).await;

    let refused = update(
        &pool,
        &occurrence(item),
        UpdateTaskRequest {
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        },
    )
    .await;

    let error = refused.expect_err("an agentic occurrence with no spec cannot start");
    assert!(error.to_string().contains("spec"), "{error}");
}

#[tokio::test]
async fn an_agentic_occurrence_with_its_templates_spec_starts() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let item = habit(&app, agentic_with(Some(brief("Sort the mail")))).await;
    served(&pool).await;

    let started = update(
        &pool,
        &occurrence(item),
        UpdateTaskRequest {
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(started.status, TaskStatus::InProgress.as_str());
}

async fn ask(
    pool: &sqlx::SqlitePool,
    parent: &NodeId,
) -> Result<arlesh_lib::tasks::model::Expectation, arlesh_lib::error::AppError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let created = write::create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Which folder?".into(),
            parent_type: "task".into(),
            parent_id: parent.clone(),
            agentic: true,
            agentic_note: Some("Archive or delete?".into()),
            ..Default::default()
        },
        at(NOW),
    )
    .await;
    if created.is_ok() {
        db.commit().await.unwrap();
    }
    created
}

#[tokio::test]
async fn an_agentic_wait_hangs_on_an_agentic_occurrence() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let item = habit(&app, agentic_with(Some(brief("Sort the mail")))).await;
    served(&pool).await;
    let tidy = occurrence(item);

    let wait = ask(&pool, &tidy).await.unwrap();

    assert!(wait.agentic);
    assert_eq!(wait.parent_id, tidy, "it hangs on the occurrence");
}

#[tokio::test]
async fn an_agentic_wait_on_an_occurrence_that_is_not_agentic_is_refused() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let item = habit(&app, TemplateUpdate::default()).await;
    served(&pool).await;

    let refused = ask(&pool, &occurrence(item)).await;

    let error = refused.expect_err("the occurrence is not agentic");
    assert!(error.to_string().contains("agentic"), "{error}");
}

/// The app's case: the flow root is marked Agentic and the item says nothing of its own, so the
/// item's occurrence reads as Agentic through its template tree — for every rule alike.
async fn agentic_root_unflagged_item(pool: &sqlx::SqlitePool, app: &App) -> i64 {
    let item = habit(app, TemplateUpdate::default()).await;
    let flow_id = {
        let mut db = helpers::session_factory(pool).connect().await.unwrap();
        db.flows()
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|flow| flow.id)
            .max()
            .unwrap()
    };
    flow_commands::update_flow(
        app.state(),
        flow_id,
        arlesh_lib::flows::model::UpdateFlowRequest {
            template: TemplateUpdate {
                agentic: Some(TaskAgentic::Yes),
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .await
    .unwrap();
    item
}

#[tokio::test]
async fn an_item_under_an_agentic_root_needs_a_spec_to_start() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let item = agentic_root_unflagged_item(&pool, &app).await;
    served(&pool).await;

    let refused = update(
        &pool,
        &occurrence(item),
        UpdateTaskRequest {
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        },
    )
    .await;

    let error = refused.expect_err("it reads as agentic through its root, so it needs a spec");
    assert!(error.to_string().contains("spec"), "{error}");
}

#[tokio::test]
async fn an_item_under_an_agentic_root_takes_an_agentic_wait() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let item = agentic_root_unflagged_item(&pool, &app).await;
    served(&pool).await;

    assert!(ask(&pool, &occurrence(item)).await.is_ok());
}

#[tokio::test]
async fn a_task_hung_on_an_item_under_an_agentic_root_is_writable_over_the_mcp() {
    use arlesh_lib::mcp::params;
    use rmcp::handler::server::wrapper::Parameters;

    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let item = agentic_root_unflagged_item(&pool, &app).await;
    served(&pool).await;
    let step = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let step = write::create_task(
            &mut db,
            arlesh_lib::tasks::model::CreateTaskRequest {
                title: "Unsubscribe from the newsletter".into(),
                parent_type: "task".into(),
                parent_id: occurrence(item),
                ..Default::default()
            },
            at(NOW),
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        step.id
            .stored()
            .expect("a task hung on an occurrence is a stored row")
    };
    let mcp = helpers::mcp_over_whole_board(&pool).await;

    let linked = mcp
        .beads(Parameters(params::BeadsOperation::Set {
            node_type: params::BeadsNode::Task,
            node_id: step,
            beads_id: Some("Arlesh-cz2".into()),
        }))
        .await
        .unwrap();

    assert_ne!(
        linked.is_error,
        Some(true),
        "it reads as agentic through the occurrence and its root: {:?}",
        linked.structured_content
    );
}
