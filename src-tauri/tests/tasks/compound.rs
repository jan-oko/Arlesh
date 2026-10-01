//! Compound: a Task that consists of its sub-items, driven through the board as the app drives
//! it — a write naming a row, then a load — and asked what the Task reads as afterwards.

use crate::helpers;
use helpers::StoredId;

use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    error::AppError,
    mindmap::{self, model::MindmapLoad},
    nodes::{id::NodeId, origin::Origin, write},
    tasks::{
        create_task,
        error::TaskError,
        lifecycle::Archival,
        model::{
            AsyncTemplate, CreateTaskRequest, Delegate, Task, TaskStatus, TimeScope,
            UpdateTaskRequest,
        },
    },
};
use chrono::NaiveDateTime;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

const NOW: &str = "2026-09-30T12:00:00";

async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: "Compound".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

async fn new_task(pool: &sqlx::SqlitePool, request: CreateTaskRequest) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let task = create_task(&mut db, request).await.unwrap();
    db.commit().await.unwrap();
    task.id.sid()
}

async fn child(pool: &sqlx::SqlitePool, parent: i64, status: TaskStatus) -> i64 {
    new_task(
        pool,
        CreateTaskRequest {
            title: "Step".into(),
            parent_type: "task".into(),
            parent_id: parent.into(),
            status: Some(status),
            ..Default::default()
        },
    )
    .await
}

/// A compound Task under the project, its stored status To Do.
async fn compound(pool: &sqlx::SqlitePool, project: i64) -> i64 {
    new_task(
        pool,
        CreateTaskRequest {
            title: "Made of steps".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            compound: Some(true),
            ..Default::default()
        },
    )
    .await
}

async fn board(pool: &sqlx::SqlitePool) -> MindmapLoad {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let load = mindmap::load(&mut db, at(NOW)).await.unwrap();
    db.commit().await.unwrap();
    load
}

fn row(load: &MindmapLoad, id: i64) -> &Task {
    load.tasks
        .iter()
        .find(|task| task.id == NodeId::Stored(id))
        .unwrap()
}

async fn write_task(
    pool: &sqlx::SqlitePool,
    id: i64,
    request: UpdateTaskRequest,
) -> Result<Task, AppError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let written = write::update_task(&mut db, &NodeId::Stored(id), request, at(NOW)).await;
    if written.is_ok() {
        db.commit().await.unwrap();
    }
    written
}

async fn stored_status(pool: &sqlx::SqlitePool, id: i64) -> String {
    sqlx::query_scalar("SELECT status FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn the_board_serves_a_compound_task_with_the_status_its_sub_items_give_it() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = compound(&pool, project).await;
    let done = child(&pool, parent, TaskStatus::Done).await;
    child(&pool, parent, TaskStatus::Todo).await;

    let load = board(&pool).await;
    assert!(row(&load, parent).compound);
    assert_eq!(row(&load, parent).status, "started");
    // Never stored: the column keeps what it held.
    assert_eq!(stored_status(&pool, parent).await, "todo");

    write_task(
        &pool,
        done,
        UpdateTaskRequest {
            status: Some(arlesh_lib::tasks::model::Status::Ordinary(
                arlesh_lib::tasks::model::TaskStatus::InProgress,
            )),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(row(&board(&pool).await, parent).status, "in_progress");
}

#[tokio::test]
async fn a_status_written_to_a_compound_task_is_refused() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = compound(&pool, project).await;

    let refused = write_task(
        &pool,
        parent,
        UpdateTaskRequest {
            status: Some(arlesh_lib::tasks::model::Status::Ordinary(
                arlesh_lib::tasks::model::TaskStatus::Done,
            )),
            ..Default::default()
        },
    )
    .await;
    assert!(matches!(
        refused,
        Err(AppError::Task(TaskError::CompoundStatus(id))) if id == parent
    ));
    assert_eq!(stored_status(&pool, parent).await, "todo");
}

#[tokio::test]
async fn switching_compound_off_keeps_the_status_it_showed() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = compound(&pool, project).await;
    child(&pool, parent, TaskStatus::Done).await;

    let written = write_task(
        &pool,
        parent,
        UpdateTaskRequest {
            compound: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(!written.compound);
    assert_eq!(written.status.as_str(), "done");
    assert_eq!(stored_status(&pool, parent).await, "done");
    let done_at: Option<String> = sqlx::query_scalar("SELECT done_at FROM tasks WHERE id = ?")
        .bind(parent)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        done_at.is_some(),
        "switching off at Done records the completion"
    );
}

#[tokio::test]
async fn switching_it_off_while_derived_in_progress_is_not_a_start() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    // Agentic with no Spec, and set aside: a start would be refused, and would leave the backlog.
    let parent = new_task(
        &pool,
        CreateTaskRequest {
            title: "Made of steps".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            compound: Some(true),
            agentic: Some(arlesh_lib::tasks::model::TaskAgentic::Yes),
            archival: Some(arlesh_lib::tasks::model::TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await;
    child(&pool, parent, TaskStatus::InProgress).await;

    let written = write_task(
        &pool,
        parent,
        UpdateTaskRequest {
            compound: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(written.status.as_str(), "in_progress");
    assert_eq!(
        written.archival,
        arlesh_lib::tasks::model::TaskArchival::Backlog
    );
}

#[tokio::test]
async fn a_request_that_switches_it_off_may_name_the_status_to_keep() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = compound(&pool, project).await;
    child(&pool, parent, TaskStatus::Done).await;

    let written = write_task(
        &pool,
        parent,
        UpdateTaskRequest {
            compound: Some(false),
            status: Some(arlesh_lib::tasks::model::Status::Ordinary(
                arlesh_lib::tasks::model::TaskStatus::Started,
            )),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(written.status.as_str(), "started");
}

#[tokio::test]
async fn a_compound_task_inside_another_is_counted_by_its_derived_status() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let outer = compound(&pool, project).await;
    let inner = new_task(
        &pool,
        CreateTaskRequest {
            title: "Inner".into(),
            parent_type: "task".into(),
            parent_id: outer.into(),
            compound: Some(true),
            ..Default::default()
        },
    )
    .await;
    child(&pool, inner, TaskStatus::Done).await;

    let load = board(&pool).await;
    assert_eq!(row(&load, inner).status, "done");
    assert_eq!(row(&load, outer).status, "done");
}

#[tokio::test]
async fn a_done_compound_task_whose_window_passed_resolves_and_archives() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let day = arlesh_lib::scopes::key::ScopeKey::Day {
        date: chrono::NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
    };
    let parent = new_task(
        &pool,
        CreateTaskRequest {
            title: "Made of steps".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            compound: Some(true),
            time_scope: Some(TimeScope::single(day)),
            ..Default::default()
        },
    )
    .await;
    child(&pool, parent, TaskStatus::Done).await;

    let load = board(&pool).await;
    assert_eq!(row(&load, parent).status, "done");
    let lifecycle = load
        .lifecycles
        .iter()
        .find(|entry| entry.node_type == "task" && entry.node_id == NodeId::Stored(parent))
        .unwrap();
    assert_eq!(lifecycle.archival, Archival::Archived);
}

#[tokio::test]
async fn a_delegated_compound_task_is_done_when_its_sub_items_are() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = new_task(
        &pool,
        CreateTaskRequest {
            title: "Handed over".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            compound: Some(true),
            ..Default::default()
        },
    )
    .await;
    let person = helpers::make_person(&pool, "Dana").await;
    write_task(
        &pool,
        parent,
        UpdateTaskRequest {
            delegate_to: Some(Some(Delegate::Person { id: person })),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let step = child(&pool, parent, TaskStatus::Todo).await;

    // Not done: its delegation wait is drawn, and does not make it Started by itself.
    let load = board(&pool).await;
    assert_eq!(row(&load, parent).status, "todo");
    let delegation_wait = |load: &MindmapLoad| {
        load.expectations.iter().any(|wait| {
            matches!(&wait.origin, Origin::DelegationWait(origin)
                if origin.task_id == NodeId::Stored(parent))
        })
    };
    assert!(delegation_wait(&load));

    write_task(
        &pool,
        step,
        UpdateTaskRequest {
            status: Some(arlesh_lib::tasks::model::Status::Ordinary(
                arlesh_lib::tasks::model::TaskStatus::Done,
            )),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // Done — though its stored status still says To Do — so the wait is gone.
    let load = board(&pool).await;
    assert_eq!(row(&load, parent).status, "done");
    assert!(!delegation_wait(&load));
}

#[tokio::test]
async fn a_compound_task_spawns_no_wait_while_it_is_compound() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    // Stored Done and Asynchronous with a template: as a plain Task it would spawn a wait.
    let parent = new_task(
        &pool,
        CreateTaskRequest {
            title: "Sends the email".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            status: Some(arlesh_lib::tasks::model::Status::Ordinary(
                arlesh_lib::tasks::model::TaskStatus::Done,
            )),
            asynchronous: Some(true),
            async_template: Some(AsyncTemplate {
                title: "Reply".into(),
                ..Default::default()
            }),
            compound: Some(true),
            ..Default::default()
        },
    )
    .await;
    child(&pool, parent, TaskStatus::Done).await;

    let load = board(&pool).await;
    assert_eq!(row(&load, parent).status, "done");
    assert!(!load.expectations.iter().any(|wait| {
        matches!(&wait.origin, Origin::SpawnedWait(origin)
            if origin.task_id == NodeId::Stored(parent))
    }));
}

#[tokio::test]
async fn a_duplicate_carries_the_flag() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = compound(&pool, project).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let copy = arlesh_lib::duplicate::duplicate_subtree(
        &mut db,
        arlesh_lib::duplicate::DuplicableKind::Task,
        parent,
        "project",
        project,
        0,
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    let load = board(&pool).await;
    assert!(row(&load, copy).compound);
}

async fn block(pool: &sqlx::SqlitePool, id: i64) {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    write::set_block_reasons(
        &mut db,
        "task",
        &NodeId::Stored(id),
        &["waiting on a part".to_string()],
        at(NOW),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
}

fn derived_block_of(load: &MindmapLoad, id: i64) -> bool {
    load.block_reasons.iter().any(|reason| {
        reason.owner_type == "task"
            && reason.owner_id == NodeId::Stored(id)
            && reason.derived == Some(arlesh_lib::block_reasons::model::DerivedBlock::Compound)
    })
}

#[tokio::test]
async fn a_compound_whose_open_sub_items_are_all_blocked_is_blocked() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = compound(&pool, project).await;
    let stuck = child(&pool, parent, TaskStatus::Todo).await;
    child(&pool, parent, TaskStatus::Done).await;
    let free = child(&pool, parent, TaskStatus::Todo).await;
    block(&pool, stuck).await;

    // One open sub-item is free: not blocked.
    assert!(!derived_block_of(&board(&pool).await, parent));

    block(&pool, free).await;
    let load = board(&pool).await;
    assert!(derived_block_of(&load, parent));
    // Derived, never stored.
    let stored: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM block_reasons WHERE owner_type = 'task' AND owner_id = ?",
    )
    .bind(parent)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, 0);
}

#[tokio::test]
async fn the_board_serves_a_compound_block_with_its_derived_reason() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = compound(&pool, project).await;
    let stuck = child(&pool, parent, TaskStatus::Todo).await;
    block(&pool, stuck).await;

    let load = board(&pool).await;
    let reason = load
        .block_reasons
        .iter()
        .find(|reason| reason.owner_id == NodeId::Stored(parent))
        .unwrap();
    assert_eq!(reason.reason, arlesh_lib::tasks::compound::blocked::REASON);
}
