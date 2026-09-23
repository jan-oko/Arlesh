//! Asynchronous and its optional template: the flag on its own, the template kept only while the
//! flag is on, the wait derived while the task is done, its overlay, and its checks.

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

fn done() -> UpdateTaskRequest {
    UpdateTaskRequest {
        status: Some(TaskStatus::Done),
        ..Default::default()
    }
}

fn reopened() -> UpdateTaskRequest {
    UpdateTaskRequest {
        status: Some(TaskStatus::Todo),
        ..Default::default()
    }
}

fn with_template() -> UpdateTaskRequest {
    UpdateTaskRequest {
        asynchronous: Some(true),
        async_template: Some(Some(weekly_template())),
        ..Default::default()
    }
}

async fn release(pool: &sqlx::SqlitePool, id: i64) {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    update_spawned_wait(
        &mut db,
        TaskId(id),
        UpdateSpawnedWaitRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
}

async fn update(pool: &sqlx::SqlitePool, id: i64, request: UpdateTaskRequest) {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    update_task(&mut db, TaskId(id), request).await.unwrap();
    db.commit().await.unwrap();
}

/// Long after any check these tests set up has fallen due.
fn far_future() -> NaiveDateTime {
    at("2099-01-01T12:00:00")
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
async fn the_flag_stands_alone_and_turning_it_off_takes_the_template() {
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
    assert!(read.asynchronous && read.async_template.is_none());
    drop(db);

    update(&pool, id, with_template()).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let read = db.tasks().get(TaskId(id)).await.unwrap();
    assert_eq!(read.async_template, Some(weekly_template()));
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
    assert!(read.asynchronous && read.async_template.is_none());
}

#[tokio::test]
async fn an_asynchronous_task_without_a_template_spawns_nothing() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, project, "Order the part").await;
    update(
        &pool,
        id,
        UpdateTaskRequest {
            asynchronous: Some(true),
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert!(db.tasks().spawned_wait(TaskId(id)).await.unwrap().is_none());
    assert!(derive_wait_windows(&mut db, far_future())
        .await
        .unwrap()
        .spawned_waits
        .is_empty());
}

#[tokio::test]
async fn the_wait_exists_while_the_task_is_done_and_holds_up_nothing() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let sender = task(&pool, project, "Send the draft").await;
    let dependent = task(&pool, project, "Merge the reply").await;
    update(&pool, sender, with_template()).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    add_task_dependency(&mut db, TaskId(dependent), Dependency::Task { id: sender })
        .await
        .unwrap();
    db.commit().await.unwrap();

    update(&pool, sender, done()).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let spawned = db.tasks().spawned_wait(TaskId(sender)).await.unwrap();
    assert!(
        spawned.is_some_and(|wait| wait.status == ExpectationStatus::Pending
            && wait.spawned_at.is_some()
            && wait.last_check_at.is_none())
    );
    // The task is done, and what depends on it does not wait on the wait it spawned.
    assert!(get_task_with_blockers(&mut db, TaskId(dependent))
        .await
        .unwrap()
        .block_reasons
        .is_empty());
    let windows = derive_wait_windows(&mut db, far_future()).await.unwrap();
    let view = &windows.spawned_waits[0];
    assert!(view.time_scope.is_some() && view.next_check.is_some());
    // The test pool holds one connection: give it back before reading the pool directly.
    drop(db);
    // Nothing is stored for it until the wait itself is changed.
    let overlays: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM spawned_waits")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(overlays, 0);

    // Reopened, the wait is simply not derived any more.
    update(&pool, sender, reopened()).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert!(db
        .tasks()
        .spawned_wait(TaskId(sender))
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn the_overlay_outlives_a_reopening_and_comes_back_with_the_completion() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let sender = task(&pool, project, "Kick off the build").await;
    update(&pool, sender, with_template()).await;
    update(&pool, sender, done()).await;
    release(&pool, sender).await;
    update(&pool, sender, reopened()).await;
    let overlays: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM spawned_waits")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(overlays, 1, "left in place, ignored");

    update(&pool, sender, done()).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let wait = db.tasks().spawned_wait(TaskId(sender)).await.unwrap();
    assert!(wait.is_some_and(|wait| wait.status == ExpectationStatus::Released));
}

#[tokio::test]
async fn a_spawned_waits_check_moves_on_and_a_released_one_has_none() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let sender = task(&pool, project, "Kick off the build").await;
    update(&pool, sender, with_template()).await;
    update(&pool, sender, done()).await;
    let checked_at = far_future();
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    complete_spawned_check(&mut db, TaskId(sender), checked_at)
        .await
        .unwrap();
    db.commit().await.unwrap();
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let wait = db.tasks().spawned_wait(TaskId(sender)).await.unwrap();
    assert_eq!(wait.and_then(|wait| wait.last_check_at), Some(checked_at));
    drop(db);

    release(&pool, sender).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let refused = complete_spawned_check(&mut db, TaskId(sender), at("2026-07-20T10:00:00")).await;
    assert!(refused.is_err());
    drop(db);
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let windows = derive_wait_windows(&mut db, far_future()).await.unwrap();
    assert!(windows.spawned_waits[0].next_check.is_none());
    // The completed check stays, done.
    let done = &windows.spawned_waits[0].done_checks;
    assert_eq!(done.len(), 1);
    assert_eq!(done[0].resolved_at, checked_at);
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

#[tokio::test]
async fn clearing_check_every_from_the_template_stops_the_checks() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let sender = task(&pool, project, "Send the draft").await;
    update(&pool, sender, with_template()).await;
    // Exactly what the Task editor sends when the section's Check every is cleared: the template
    // without the key.
    let request: UpdateTaskRequest = serde_json::from_value(serde_json::json!({
        "asynchronous": true,
        "async_template": { "title": "Reviewer replies", "tag_ids": [] },
    }))
    .unwrap();
    update(&pool, sender, request).await;
    update(&pool, sender, done()).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let read = db.tasks().get(TaskId(sender)).await.unwrap();
    assert!(read.async_template.is_some_and(|t| t.check_every.is_none()));
    let windows = derive_wait_windows(&mut db, far_future()).await.unwrap();
    assert!(windows.spawned_waits[0].next_check.is_none());
}
