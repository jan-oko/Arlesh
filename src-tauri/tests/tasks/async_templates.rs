//! Asynchronous as a template: the toggle and an explicit template, the wait a task's completion
//! spawns, its retraction, its checks, and what it holds up.

use crate::helpers;

use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    tasks::{
        add_task_dependency, create_task, get_task_with_blockers,
        model::{
            AsyncTemplate, CreateTaskRequest, Dependency, DurationSpec, ExpectationStatus, TaskId,
            TaskStatus, UpdateSpawnedWaitRequest, UpdateTaskRequest,
        },
        update_task,
        waits::{complete_spawned_check, derive_wait_windows, update_spawned_wait},
    },
};
use chrono::NaiveDateTime;

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
            title: "Async".into(),
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

async fn task(pool: &sqlx::SqlitePool, project: i64, title: &str) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: title.into(),
            parent_type: "project".into(),
            parent_id: project,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    task.id
}

async fn update(pool: &sqlx::SqlitePool, id: i64, request: UpdateTaskRequest) {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    update_task(&mut db, TaskId(id), request).await.unwrap();
    db.commit().await.unwrap();
}

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn weekly_template() -> AsyncTemplate {
    AsyncTemplate {
        title: "Reviewer replies".into(),
        tag_ids: vec![],
        time_scope: Some(DurationSpec {
            n: 2,
            kind: "week".into(),
        }),
        check_every: Some(DurationSpec {
            n: 1,
            kind: "week".into(),
        }),
    }
}

#[tokio::test]
async fn the_toggle_gives_a_default_template_and_takes_it_away() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, project, "Send the draft").await;
    update(
        &pool,
        id,
        UpdateTaskRequest {
            asynchronous: Some(true),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let read = db.tasks().get(TaskId(id)).await.unwrap();
    assert!(read.asynchronous);
    assert_eq!(
        read.async_template,
        Some(AsyncTemplate::for_task("Send the draft"))
    );
    drop(db);
    update(
        &pool,
        id,
        UpdateTaskRequest {
            asynchronous: Some(false),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let read = db.tasks().get(TaskId(id)).await.unwrap();
    assert!(!read.asynchronous && read.async_template.is_none());
}

#[tokio::test]
async fn completing_an_asynchronous_task_spawns_its_wait_and_un_completing_retracts_it() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let sender = task(&pool, project, "Send the draft").await;
    let dependent = task(&pool, project, "Merge the reply").await;
    update(
        &pool,
        sender,
        UpdateTaskRequest {
            async_template: Some(Some(weekly_template())),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    add_task_dependency(&mut db, TaskId(dependent), Dependency::Task { id: sender })
        .await
        .unwrap();
    db.commit().await.unwrap();

    update(
        &pool,
        sender,
        UpdateTaskRequest {
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let spawned = db.tasks().spawned_wait(TaskId(sender)).await.unwrap();
    assert!(spawned.is_some_and(|wait| wait.status == ExpectationStatus::Pending));
    // The task is done, but what depends on it waits on the wait it spawned.
    let reasons = get_task_with_blockers(&mut db, TaskId(dependent))
        .await
        .unwrap()
        .block_reasons;
    assert_eq!(
        reasons,
        [format!(
            "Blocked by expectation spawned by task {sender} (Reviewer replies)"
        )]
    );
    let windows = derive_wait_windows(&mut db).await.unwrap();
    let view = &windows.spawned_waits[0];
    assert!(view.time_scope.is_some() && view.next_check.is_some());
    drop(db);

    // Released, the dependent is free.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_spawned_wait(
        &mut db,
        TaskId(sender),
        UpdateSpawnedWaitRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert!(get_task_with_blockers(&mut db, TaskId(dependent))
        .await
        .unwrap()
        .block_reasons
        .is_empty());
    drop(db);

    // Un-completing the task retracts the wait altogether.
    update(
        &pool,
        sender,
        UpdateTaskRequest {
            status: Some(TaskStatus::Todo),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert!(db
        .tasks()
        .spawned_wait(TaskId(sender))
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn a_spawned_waits_check_moves_on_and_a_released_one_has_none() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let sender = task(&pool, project, "Kick off the build").await;
    update(
        &pool,
        sender,
        UpdateTaskRequest {
            async_template: Some(Some(weekly_template())),
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    complete_spawned_check(&mut db, TaskId(sender), at("2026-07-09T10:00:00"))
        .await
        .unwrap();
    db.commit().await.unwrap();
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let wait = db.tasks().spawned_wait(TaskId(sender)).await.unwrap();
    assert_eq!(
        wait.and_then(|wait| wait.last_check_at),
        Some(at("2026-07-09T10:00:00"))
    );
    drop(db);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_spawned_wait(
        &mut db,
        TaskId(sender),
        UpdateSpawnedWaitRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let refused = complete_spawned_check(&mut db, TaskId(sender), at("2026-07-20T10:00:00")).await;
    assert!(refused.is_err());
    drop(db);
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let windows = derive_wait_windows(&mut db).await.unwrap();
    assert!(windows.spawned_waits[0].next_check.is_none());
}

#[tokio::test]
async fn a_task_without_a_spawned_wait_refuses_one_being_changed() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let plain = task(&pool, project, "Plain").await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    assert!(
        update_spawned_wait(&mut db, TaskId(plain), UpdateSpawnedWaitRequest::default())
            .await
            .is_err()
    );
    assert!(
        complete_spawned_check(&mut db, TaskId(plain), at("2026-07-20T10:00:00"))
            .await
            .is_err()
    );
}
