//! A wait's derived rows (ADR 0008): its check tasks are Task rows, a Task's spawned wait and a
//! delegated Task's wait are Expectation rows. Each test drives the board through the virtual
//! tables — a write naming a row id, then a load — and asks what the row is afterwards.

use crate::helpers;

use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    mindmap::{self, model::MindmapLoad},
    nodes::{id::NodeId, origin::Origin, write},
    tasks::{
        create_expectation, create_task,
        model::{
            AsyncTemplate, CreateExpectationRequest, CreateTaskRequest, Delegate, DurationSpec,
            Expectation, ExpectationStatus, Task, TaskId, TaskStatus, UpdateExpectationRequest,
            UpdateTaskRequest,
        },
        update_task,
    },
};
use chrono::NaiveDateTime;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

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
            title: "Waits".into(),
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

/// A wait checked on every three days from 3 July, 09:00.
async fn checked_wait(pool: &sqlx::SqlitePool, project: i64) -> Expectation {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let wait = create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Reviewer replies".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            check_every: Some(DurationSpec {
                n: 3,
                kind: "day".into(),
            }),
            check_starting: Some(at("2026-07-03T09:00:00")),
            time_scope: None,
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    wait
}

async fn board(pool: &sqlx::SqlitePool, now: &str) -> MindmapLoad {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let load = mindmap::load(&mut db, at(now)).await.unwrap();
    db.commit().await.unwrap();
    load
}

fn checks_of(load: &MindmapLoad, wait: &NodeId) -> Vec<Task> {
    load.tasks
        .iter()
        .filter(|task| matches!(task.origin, Origin::Check(_)) && &task.parent_id == wait)
        .cloned()
        .collect()
}

async fn write_task(
    pool: &sqlx::SqlitePool,
    id: &NodeId,
    request: UpdateTaskRequest,
    now: &str,
) -> Result<Task, arlesh_lib::error::AppError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let written = write::update_task(&mut db, id, request, at(now)).await;
    if written.is_ok() {
        db.commit().await.unwrap();
    }
    written
}

fn status(status: TaskStatus) -> UpdateTaskRequest {
    UpdateTaskRequest {
        status: Some(status),
        ..Default::default()
    }
}

#[tokio::test]
async fn a_due_check_is_a_task_row_under_its_wait() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let wait = checked_wait(&pool, project).await;

    let load = board(&pool, "2026-07-04T10:00:00").await;
    let checks = checks_of(&load, &wait.id);
    assert_eq!(checks.len(), 1, "the one check due is drawn");
    let check = &checks[0];
    assert!(check.id.is_derived());
    assert_eq!(check.parent_type, "expectation");
    assert_eq!(check.status, "todo");
    assert_eq!(check.title, "Reviewer replies");
    assert!(check.time_scope.is_some(), "drawn on the day it fell due");
    assert!(
        load.lifecycles
            .iter()
            .any(|lifecycle| lifecycle.node_id == check.id),
        "timed under its own row id"
    );
}

#[tokio::test]
async fn a_check_task_cycles_like_a_task_and_done_records_the_check() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let wait = checked_wait(&pool, project).await;
    let now = "2026-07-04T10:00:00";
    let check = checks_of(&board(&pool, now).await, &wait.id)[0].clone();

    let started = write_task(&pool, &check.id, status(TaskStatus::InProgress), now)
        .await
        .unwrap();
    assert_eq!(started.status, "in_progress");

    let done = write_task(&pool, &check.id, status(TaskStatus::Done), now)
        .await
        .unwrap();
    assert_eq!(done.id, check.id, "the check keeps its row id once made");
    assert_eq!(done.status, "done");
    let recorded: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM wait_checks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(recorded, 1);

    let reopened = write_task(&pool, &check.id, status(TaskStatus::Todo), now)
        .await
        .unwrap();
    assert_eq!(reopened.status, "todo");
    let recorded: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM wait_checks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(recorded, 0, "taking the check back reopens it");
}

#[tokio::test]
async fn a_check_task_carries_a_title_tags_and_block_reasons_of_its_own() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let wait = checked_wait(&pool, project).await;
    let now = "2026-07-04T10:00:00";
    let check = checks_of(&board(&pool, now).await, &wait.id)[0].clone();

    write_task(
        &pool,
        &check.id,
        UpdateTaskRequest {
            title: Some("Ask the reviewer".into()),
            ..Default::default()
        },
        now,
    )
    .await
    .unwrap();
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    write::set_tag(&mut db, "task", &check.id, project, true, at(now))
        .await
        .unwrap();
    write::set_block_reasons(
        &mut db,
        "task",
        &check.id,
        &["phone is off".into()],
        at(now),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let load = board(&pool, now).await;
    let redrawn = checks_of(&load, &wait.id)[0].clone();
    assert_eq!(redrawn.title, "Ask the reviewer");
    assert_eq!(redrawn.tag_ids, vec![project]);
    assert!(load
        .block_reasons
        .iter()
        .any(|reason| reason.owner_id == check.id && reason.reason == "phone is off"));
}

#[tokio::test]
async fn a_check_task_cannot_leave_its_wait_or_be_delegated_or_deleted() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let wait = checked_wait(&pool, project).await;
    let now = "2026-07-04T10:00:00";
    let check = checks_of(&board(&pool, now).await, &wait.id)[0].clone();

    let moved = write_task(
        &pool,
        &check.id,
        UpdateTaskRequest {
            parent_type: Some("project".into()),
            parent_id: Some(project.into()),
            ..Default::default()
        },
        now,
    )
    .await;
    assert!(moved.is_err());
    let delegated = write_task(
        &pool,
        &check.id,
        UpdateTaskRequest {
            delegate_to: Some(Some(Delegate::Agent)),
            ..Default::default()
        },
        now,
    )
    .await;
    assert!(delegated.is_err());
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    assert!(write::delete(&mut db, "task", &check.id, at(now))
        .await
        .is_err());
}

async fn task(pool: &sqlx::SqlitePool, project: i64, request: UpdateTaskRequest) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let created = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Send the draft".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let id = created.id.stored().unwrap();
    update_task(&mut db, TaskId(id), request).await.unwrap();
    db.commit().await.unwrap();
    id
}

#[tokio::test]
async fn a_done_asynchronous_tasks_wait_is_an_expectation_row_released_like_any_wait() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let sender = task(
        &pool,
        project,
        UpdateTaskRequest {
            asynchronous: Some(true),
            async_template: Some(Some(AsyncTemplate {
                title: "Reviewer replies".into(),
                tag_ids: vec![],
                time_scope: None,
                check_every: Some(DurationSpec {
                    n: 1,
                    kind: "week".into(),
                }),
            })),
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
    )
    .await;
    let now = "2099-01-01T12:00:00";
    let load = board(&pool, now).await;
    let spawned = load
        .expectations
        .iter()
        .find(|expectation| matches!(expectation.origin, Origin::SpawnedWait(_)))
        .expect("the spawned wait is a row")
        .clone();
    assert_eq!(spawned.parent_id, NodeId::Stored(sender));
    assert_eq!(spawned.title, "Reviewer replies");
    assert_eq!(checks_of(&load, &spawned.id).len(), 1, "its check is due");

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let released = write::update_expectation(
        &mut db,
        &spawned.id,
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
        at(now),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    assert_eq!(released.status, ExpectationStatus::Released);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let retitled = write::update_expectation(
        &mut db,
        &spawned.id,
        UpdateExpectationRequest {
            title: Some("Something else".into()),
            ..Default::default()
        },
        at(now),
    )
    .await;
    assert!(retitled.is_err(), "its title is its Task's template's");
}

#[tokio::test]
async fn a_delegated_tasks_wait_is_a_row_nothing_but_the_task_releases() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let delegated = task(
        &pool,
        project,
        UpdateTaskRequest {
            delegate_to: Some(Some(Delegate::Agent)),
            ..Default::default()
        },
    )
    .await;
    let now = "2026-07-04T10:00:00";
    let load = board(&pool, now).await;
    let wait = load
        .expectations
        .iter()
        .find(|expectation| matches!(expectation.origin, Origin::DelegationWait(_)))
        .expect("the delegation wait is a row")
        .clone();
    assert_eq!(wait.parent_id, NodeId::Stored(delegated));
    assert_eq!(wait.status, ExpectationStatus::Pending);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let released = write::update_expectation(
        &mut db,
        &wait.id,
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
        at(now),
    )
    .await;
    assert!(released.is_err());
    drop(db);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_task(&mut db, TaskId(delegated), status(TaskStatus::Done))
        .await
        .unwrap();
    db.commit().await.unwrap();
    assert!(
        !board(&pool, now)
            .await
            .expectations
            .iter()
            .any(|expectation| expectation.id == wait.id),
        "the Task done, its wait is over"
    );
}
