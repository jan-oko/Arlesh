//! Expectations against a real database: the row, the dependency edges aimed at it, the virtual
//! block reason it gives a Task, its lifecycle entry, the subtree delete and the retype paths that
//! have to carry one.

use crate::helpers;

use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    infos::model::CreateInfoRequest,
    scopes::model::ScopeKind,
    tasks::{
        add_task_dependency, clear_check_by, create_expectation, create_task, delete_expectation,
        delete_task, derive_all_scope_lifecycles,
        error::TaskError,
        get_task_with_blockers,
        lifecycle::{Archival, Resolution, Timing},
        model::{
            CreateExpectationRequest, CreateTaskRequest, Dependency, Expectation,
            ExpectationArchival, ExpectationId, ExpectationStatus, TaskId, TimeScope,
            UpdateExpectationRequest,
        },
        retype::{apply_retype, plan_node_retype, RetypeKind, StrandedChildren},
        update_expectation,
    },
};
use chrono::{NaiveDate, NaiveDateTime};

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

async fn day(pool: &sqlx::SqlitePool, date: NaiveDate) -> TimeScope {
    let scope = helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .scopes()
        .get_or_create(ScopeKind::Day, date)
        .await
        .unwrap();
    TimeScope {
        start_id: scope.id,
        end_id: scope.id,
        duration: None,
    }
}

async fn task(pool: &sqlx::SqlitePool, parent_type: &str, parent_id: i64) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Send the draft".into(),
            parent_type: parent_type.into(),
            parent_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    task.id
}

async fn expectation(
    pool: &sqlx::SqlitePool,
    parent_type: &str,
    parent_id: i64,
    check_by: Option<TimeScope>,
) -> Expectation {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let expectation = create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Reviewer replies".into(),
            parent_type: parent_type.into(),
            parent_id,
            check_by,
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    expectation
}

async fn update(pool: &sqlx::SqlitePool, id: i64, request: UpdateExpectationRequest) {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    update_expectation(&mut db, ExpectationId(id), request)
        .await
        .unwrap();
    db.commit().await.unwrap();
}

async fn depend(pool: &sqlx::SqlitePool, task_id: i64, expectation_id: i64) {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    add_task_dependency(
        &mut db,
        TaskId(task_id),
        Dependency::Expectation { id: expectation_id },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
}

async fn block_reasons(pool: &sqlx::SqlitePool, task_id: i64) -> Vec<String> {
    let mut db = helpers::session_factory(pool).connect().await.unwrap();
    get_task_with_blockers(&mut db, TaskId(task_id))
        .await
        .unwrap()
        .block_reasons
}

async fn inbound_edges(pool: &sqlx::SqlitePool, expectation_id: i64) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM task_dependencies WHERE dependency_type = 'expectation' AND dependency_id = ?",
    )
    .bind(expectation_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

#[tokio::test]
async fn a_new_expectation_is_pending_live_and_has_no_check_by_unless_given_one() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let bare = expectation(&pool, "project", project, None).await;
    assert_eq!(bare.status, ExpectationStatus::Pending);
    assert_eq!(bare.archival, ExpectationArchival::Live);
    assert!(bare.check_by.is_none());

    let check_by = day(&pool, NaiveDate::from_ymd_opt(2026, 7, 3).unwrap()).await;
    let checked = expectation(&pool, "project", project, Some(check_by.clone())).await;
    assert_eq!(checked.check_by, Some(check_by));

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let listed = db.expectations().list().await.unwrap();
    assert_eq!(listed.len(), 2);
}

#[tokio::test]
async fn a_pending_expectation_blocks_a_task_depending_on_it_until_released() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let task_id = task(&pool, "project", project).await;
    let wait = expectation(&pool, "project", project, None).await;
    depend(&pool, task_id, wait.id).await;

    assert_eq!(
        block_reasons(&pool, task_id).await,
        [format!(
            "Blocked by expectation {} (Reviewer replies)",
            wait.id
        )]
    );

    update(
        &pool,
        wait.id,
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
    )
    .await;
    assert!(block_reasons(&pool, task_id).await.is_empty());

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let dependencies = db.tasks().list_dependencies(TaskId(task_id)).await.unwrap();
    assert!(matches!(
        dependencies.as_slice(),
        [Dependency::Expectation { id }] if *id == wait.id
    ));
}

#[tokio::test]
async fn depending_on_an_expectation_that_does_not_exist_is_refused() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let task_id = task(&pool, "project", project).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let refused = add_task_dependency(
        &mut db,
        TaskId(task_id),
        Dependency::Expectation { id: 999 },
    )
    .await;
    assert!(matches!(refused, Err(TaskError::ExpectationNotFound(999))));
}

#[tokio::test]
async fn completing_the_check_clears_the_check_by_and_leaves_it_pending() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let check_by = day(&pool, NaiveDate::from_ymd_opt(2026, 7, 3).unwrap()).await;
    let wait = expectation(&pool, "project", project, Some(check_by)).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let cleared = clear_check_by(&mut db, ExpectationId(wait.id))
        .await
        .unwrap();
    db.commit().await.unwrap();
    assert!(cleared.check_by.is_none());
    assert_eq!(cleared.status, ExpectationStatus::Pending);

    // A second completion has no check to complete, and says so.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let refused = clear_check_by(&mut db, ExpectationId(wait.id)).await;
    assert!(matches!(
        refused,
        Err(TaskError::ExpectationHasNoCheckBy(_))
    ));
}

#[tokio::test]
async fn the_lifecycle_entry_times_the_check_by_and_carries_the_archive() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let check_by = day(&pool, NaiveDate::from_ymd_opt(2026, 7, 3).unwrap()).await;
    let late = expectation(&pool, "project", project, Some(check_by)).await;
    let archived = expectation(&pool, "project", project, None).await;
    update(
        &pool,
        archived.id,
        UpdateExpectationRequest {
            archival: Some(ExpectationArchival::Archived),
            ..Default::default()
        },
    )
    .await;

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let lifecycles = derive_all_scope_lifecycles(&mut db, at("2026-07-10T12:00:00"))
        .await
        .unwrap();
    let entry = |id: i64| {
        lifecycles
            .iter()
            .find(|l| l.node_type == "expectation" && l.node_id == id)
            .unwrap()
    };
    assert_eq!(entry(late.id).timing, Timing::Lapsed);
    assert_eq!(entry(late.id).resolution, Some(Resolution::Overdue));
    assert_eq!(entry(archived.id).timing, Timing::Active);
    assert_eq!(entry(archived.id).archival, Archival::Archived);
}

#[tokio::test]
async fn deleting_an_expectation_takes_its_notes_and_the_edges_aimed_at_it() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let task_id = task(&pool, "project", project).await;
    let wait = expectation(&pool, "project", project, None).await;
    depend(&pool, task_id, wait.id).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    db.infos()
        .create(CreateInfoRequest {
            body: "asked on Monday".into(),
            details: None,
            parent_type: "expectation".into(),
            parent_id: wait.id,
            position: 0,
        })
        .await
        .unwrap();
    delete_expectation(&mut db, ExpectationId(wait.id))
        .await
        .unwrap();
    db.commit().await.unwrap();

    assert_eq!(inbound_edges(&pool, wait.id).await, 0);
    let notes: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM infos WHERE parent_type = 'expectation'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(notes, 0);
    assert!(block_reasons(&pool, task_id).await.is_empty());
}

#[tokio::test]
async fn deleting_a_task_takes_the_expectation_beneath_it() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(&pool, "project", project).await;
    let dependent = task(&pool, "project", project).await;
    let wait = expectation(&pool, "task", parent, None).await;
    depend(&pool, dependent, wait.id).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    delete_task(&mut db, TaskId(parent)).await.unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert!(matches!(
        db.expectations().get(ExpectationId(wait.id)).await,
        Err(TaskError::ExpectationNotFound(_))
    ));
    // The pool holds one connection: give it back before asking on another.
    drop(db);
    assert_eq!(inbound_edges(&pool, wait.id).await, 0);
}

#[tokio::test]
async fn retyping_a_task_to_a_goal_carries_its_expectation_across() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(&pool, "project", project).await;
    let wait = expectation(&pool, "task", parent, None).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let planned = plan_node_retype(&mut db, RetypeKind::Task, parent, RetypeKind::Goal)
        .await
        .unwrap();
    let goal = apply_retype(&mut db, &planned, StrandedChildren::Reparent)
        .await
        .unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let moved = db.expectations().get(ExpectationId(wait.id)).await.unwrap();
    assert_eq!(moved.parent_type, "goal");
    assert_eq!(moved.parent_id, goal.id);
}

#[tokio::test]
async fn retyping_a_task_to_a_tag_strands_its_expectation_up_to_the_parent() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(&pool, "project", project).await;
    let wait = expectation(&pool, "task", parent, None).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let planned = plan_node_retype(&mut db, RetypeKind::Task, parent, RetypeKind::Tag)
        .await
        .unwrap();
    apply_retype(&mut db, &planned, StrandedChildren::Reparent)
        .await
        .unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let moved = db.expectations().get(ExpectationId(wait.id)).await.unwrap();
    assert_eq!(moved.parent_type, "project");
    assert_eq!(moved.parent_id, project);
}

#[tokio::test]
async fn retyping_a_task_to_an_info_deletes_a_stranded_expectation_when_asked() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(&pool, "project", project).await;
    let wait = expectation(&pool, "task", parent, None).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let planned = plan_node_retype(&mut db, RetypeKind::Task, parent, RetypeKind::Info)
        .await
        .unwrap();
    apply_retype(&mut db, &planned, StrandedChildren::Delete)
        .await
        .unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert!(db.expectations().get(ExpectationId(wait.id)).await.is_err());
}

#[tokio::test]
async fn a_note_under_an_expectation_retyped_to_a_task_climbs_past_it() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let wait = expectation(&pool, "project", project, None).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let note = db
        .infos()
        .create(CreateInfoRequest {
            body: "ping them Friday".into(),
            details: None,
            parent_type: "expectation".into(),
            parent_id: wait.id,
            position: 0,
        })
        .await
        .unwrap();
    let planned = plan_node_retype(&mut db, RetypeKind::Info, note.id, RetypeKind::Task)
        .await
        .unwrap();
    let climb = planned
        .plan
        .parent_climb
        .clone()
        .expect("a Task cannot hang under a wait");
    assert_eq!(climb.from.kind, "expectation");
    assert_eq!(climb.from.title, "Reviewer replies");
    let retyped = apply_retype(&mut db, &planned, StrandedChildren::Reparent)
        .await
        .unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let task = db.tasks().get(TaskId(retyped.id)).await.unwrap();
    assert_eq!(task.parent_type, "project");
    assert_eq!(task.parent_id, project);
}

#[tokio::test]
async fn moving_an_expectation_rewrites_its_parent_link() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(&pool, "project", project).await;
    let wait = expectation(&pool, "project", project, None).await;
    update(
        &pool,
        wait.id,
        UpdateExpectationRequest {
            parent_type: Some("task".into()),
            parent_id: Some(parent),
            title: Some("Build finishes".into()),
            is_private: Some(true),
            position: Some(3),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let moved = db.expectations().get(ExpectationId(wait.id)).await.unwrap();
    assert_eq!(
        (moved.parent_type.as_str(), moved.parent_id),
        ("task", parent)
    );
    assert_eq!(moved.title, "Build finishes");
    assert!(moved.is_private);
    assert_eq!(moved.position, 3);
}
