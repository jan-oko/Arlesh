//! The hand archive (Task 269): a Task or Commitment archived by hand archives its whole subtree
//! on the board load, writing nothing below it, and unarchiving brings the subtree back; a wait
//! archives itself once released with no window.

use crate::helpers;

use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    mindmap::{self, model::MindmapLoad},
    nodes::id::NodeId,
    scopes::model::{Scope, ScopeKind},
    tasks::{
        create_commitment, create_expectation, create_task,
        lifecycle::Archival,
        model::{
            CommitmentArchival, CommitmentId, CreateCommitmentRequest, CreateExpectationRequest,
            CreateTaskRequest, ExpectationId, ExpectationStatus, TaskArchival, TaskId, TimeScope,
            UpdateCommitmentRequest, UpdateExpectationRequest, UpdateTaskRequest,
        },
        update_commitment, update_expectation, update_task,
    },
};
use chrono::{NaiveDate, NaiveDateTime};

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
            title: "Shelf".into(),
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

fn day(date: NaiveDate) -> TimeScope {
    let scope = Scope::containing(ScopeKind::Day, date).unwrap();
    TimeScope {
        start_id: scope.id,
        end_id: scope.id,
        duration: None,
    }
}

async fn board(pool: &sqlx::SqlitePool, now: &str) -> MindmapLoad {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let load = mindmap::load(&mut db, at(now)).await.unwrap();
    db.commit().await.unwrap();
    load
}

fn archival_of(load: &MindmapLoad, node_type: &str, id: i64) -> Archival {
    load.lifecycles
        .iter()
        .find(|entry| entry.node_type == node_type && entry.node_id == NodeId::Stored(id))
        .map(|entry| entry.archival)
        .unwrap_or(Archival::Live)
}

fn overdue(load: &MindmapLoad, id: i64) -> bool {
    load.lifecycles.iter().any(|entry| {
        entry.node_type == "task" && entry.node_id == NodeId::Stored(id) && entry.overdue
    })
}

async fn task(pool: &sqlx::SqlitePool, parent_type: &str, parent_id: i64, title: &str) -> i64 {
    task_with(
        pool,
        CreateTaskRequest {
            title: title.into(),
            parent_type: parent_type.into(),
            parent_id: parent_id.into(),
            ..Default::default()
        },
    )
    .await
}

async fn task_with(pool: &sqlx::SqlitePool, request: CreateTaskRequest) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let created = create_task(&mut db, request).await.unwrap();
    db.commit().await.unwrap();
    created.id.require_stored().unwrap()
}

async fn wait(pool: &sqlx::SqlitePool, parent_type: &str, parent_id: i64) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let created = create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Reply".into(),
            parent_type: parent_type.into(),
            parent_id: parent_id.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    created.id.require_stored().unwrap()
}

async fn set_task_archival(pool: &sqlx::SqlitePool, id: i64, archival: TaskArchival) {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    update_task(
        &mut db,
        TaskId(id),
        UpdateTaskRequest {
            archival: Some(archival),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
}

#[tokio::test]
async fn archiving_a_task_archives_its_whole_subtree_and_unarchiving_brings_it_back() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(&pool, "project", project, "Renovation").await;
    // A Keep Overdue step whose window has passed: Overdue while it is live.
    let step = task_with(
        &pool,
        CreateTaskRequest {
            title: "Paint".into(),
            parent_type: "task".into(),
            parent_id: parent.into(),
            time_scope: Some(day(NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())),
            ..Default::default()
        },
    )
    .await;
    let reply = wait(&pool, "task", step).await;
    let sibling = task(&pool, "project", project, "Elsewhere").await;
    let now = "2026-07-10T12:00:00";
    assert!(overdue(&board(&pool, now).await, step), "late while live");

    set_task_archival(&pool, parent, TaskArchival::Archived).await;
    let archived = board(&pool, now).await;

    assert_eq!(archival_of(&archived, "task", parent), Archival::Archived);
    assert_eq!(archival_of(&archived, "task", step), Archival::Archived);
    assert_eq!(
        archival_of(&archived, "expectation", reply),
        Archival::Archived
    );
    assert_eq!(archival_of(&archived, "task", sibling), Archival::Live);
    assert!(!overdue(&archived, step), "nothing archived is Overdue");
    let stored_step: String = sqlx::query_scalar("SELECT archival FROM tasks WHERE id = ?")
        .bind(step)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        stored_step, "live",
        "nothing below the archived Task is written"
    );

    set_task_archival(&pool, parent, TaskArchival::Live).await;
    let back = board(&pool, now).await;

    assert_eq!(archival_of(&back, "task", parent), Archival::Live);
    assert_eq!(archival_of(&back, "task", step), Archival::Live);
    assert_eq!(archival_of(&back, "expectation", reply), Archival::Live);
    assert!(overdue(&back, step), "the subtree comes back as it was");
}

#[tokio::test]
async fn archiving_a_backlogged_task_takes_it_out_of_the_backlog() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parked = task(&pool, "project", project, "Someday").await;
    set_task_archival(&pool, parked, TaskArchival::Backlog).await;

    set_task_archival(&pool, parked, TaskArchival::Archived).await;

    let stored: String = sqlx::query_scalar("SELECT archival FROM tasks WHERE id = ?")
        .bind(parked)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, "archived", "one stored value: never both");
}

#[tokio::test]
async fn a_commitment_archived_by_hand_archives_with_its_subtree() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let commitment = create_commitment(
        &mut db,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            time_scope: Some(day(NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
    .require_stored()
    .unwrap();
    db.commit().await.unwrap();
    let step = task(&pool, "commitment", commitment, "Phone away").await;
    let now = "2026-07-01T12:00:00";
    assert_eq!(
        archival_of(&board(&pool, now).await, "commitment", commitment),
        Archival::Live
    );

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let archived = update_commitment(
        &mut db,
        CommitmentId(commitment),
        UpdateCommitmentRequest {
            archival: Some(CommitmentArchival::Archived),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    assert_eq!(archived.archival, CommitmentArchival::Archived);

    let load = board(&pool, now).await;
    assert_eq!(
        archival_of(&load, "commitment", commitment),
        Archival::Archived
    );
    assert_eq!(archival_of(&load, "task", step), Archival::Archived);
}

#[tokio::test]
async fn a_released_wait_with_no_window_reads_archived_and_a_pending_one_does_not() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let released = wait(&pool, "project", project).await;
    let pending = wait(&pool, "project", project).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_expectation(
        &mut db,
        ExpectationId(released),
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let load = board(&pool, "2026-07-01T12:00:00").await;

    assert_eq!(
        archival_of(&load, "expectation", released),
        Archival::Archived
    );
    assert_eq!(archival_of(&load, "expectation", pending), Archival::Live);
}
