//! An **Overdue** Task — its own window passed, not Done, Keep-on-exit — may be planned outside
//! that window, so it can be rescheduled into now or later. Its Time Scope is left as it is, and
//! every other bound still holds.

use crate::helpers;

use arlesh_lib::{
    database::session::SessionFactory,
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    scopes::{key::ScopeKey, model::ScopeKind},
    tasks::{
        create_task_at,
        error::TaskError,
        model::{
            CreateTaskRequest, OnScopeExit, Task, TaskId, TaskStatus, TimeScope, UpdateTaskRequest,
        },
        update_task_at,
    },
};
use chrono::{NaiveDate, NaiveDateTime};
use helpers::StoredId;

fn date(month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, month, day).unwrap()
}

/// Noon on a day of 2026 — the instant a write is judged at.
fn at(month: u32, day: u32) -> NaiveDateTime {
    date(month, day).and_hms_opt(12, 0, 0).unwrap()
}

/// The Week of 2026 holding `month`/`day`, as a single-scope window.
fn week(month: u32, day: u32) -> TimeScope {
    let key = ScopeKey::containing(ScopeKind::Week, date(month, day)).unwrap();
    TimeScope {
        start_id: key,
        end_id: key,
        duration: None,
    }
}

async fn make_project(factory: &SessionFactory, pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    factory
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: "Test Project".into(),
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

/// Creates a task in its own transaction, committed, as of mid-July — before any window below
/// has passed.
async fn create(factory: &SessionFactory, request: CreateTaskRequest) -> Task {
    let mut db = factory.begin().await.unwrap();
    let task = create_task_at(&mut db, request, at(7, 1)).await.unwrap();
    db.commit().await.unwrap();
    task
}

/// A task under the project, its own window the week of 15 July.
async fn july_task(factory: &SessionFactory, project_id: i64, on_exit: OnScopeExit) -> Task {
    create(
        factory,
        CreateTaskRequest {
            title: "Late work".into(),
            parent_type: "project".into(),
            parent_id: project_id.into(),
            time_scope: Some(week(7, 15)),
            on_scope_exit: Some(on_exit),
            ..Default::default()
        },
    )
    .await
}

/// Plans `task` into `plan` as of `now`, committing only if the write is accepted.
async fn plan_at(
    factory: &SessionFactory,
    task: &Task,
    plan: TimeScope,
    now: NaiveDateTime,
) -> Result<Task, TaskError> {
    let mut db = factory.begin().await.unwrap();
    let result = update_task_at(
        &mut db,
        TaskId(task.id.sid()),
        UpdateTaskRequest {
            plan: Some(Some(plan)),
            ..Default::default()
        },
        now,
    )
    .await;
    if result.is_ok() {
        db.commit().await.unwrap();
    }
    result
}

fn refused_for_containment(result: Result<Task, TaskError>) -> String {
    match result {
        Err(TaskError::ScopeContainment(message)) => message,
        other => panic!("expected a containment refusal, got {other:?}"),
    }
}

#[tokio::test]
async fn an_overdue_task_is_planned_after_its_window_and_keeps_its_time_scope() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project_id = make_project(&factory, &pool).await;
    let task = july_task(&factory, project_id, OnScopeExit::Keep).await;

    // Late September: the July week has passed and the task is not done.
    let planned = plan_at(&factory, &task, week(9, 27), at(9, 27))
        .await
        .unwrap();

    assert_eq!(planned.plan, Some(week(9, 27)));
    assert_eq!(planned.time_scope, Some(week(7, 15)));
}

#[tokio::test]
async fn a_task_whose_window_has_not_passed_is_refused_as_before() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project_id = make_project(&factory, &pool).await;
    let task = july_task(&factory, project_id, OnScopeExit::Keep).await;

    // Mid-July: the window is still open, so a Plan in September escapes it.
    let result = plan_at(&factory, &task, week(9, 27), at(7, 16)).await;

    assert_eq!(
        refused_for_containment(result),
        "plan is not within the task's time scope"
    );
}

#[tokio::test]
async fn a_done_task_is_not_exempt() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project_id = make_project(&factory, &pool).await;
    let task = create(
        &factory,
        CreateTaskRequest {
            title: "Finished late".into(),
            parent_type: "project".into(),
            parent_id: project_id.into(),
            time_scope: Some(week(7, 15)),
            on_scope_exit: Some(OnScopeExit::Keep),
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
    )
    .await;

    let result = plan_at(&factory, &task, week(9, 27), at(9, 27)).await;

    assert_eq!(
        refused_for_containment(result),
        "plan is not within the task's time scope"
    );
}

#[tokio::test]
async fn a_missed_task_is_not_exempt() {
    // Archive-on-exit: a passed window reads Missed and archives it, not Overdue.
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project_id = make_project(&factory, &pool).await;
    let task = july_task(&factory, project_id, OnScopeExit::Archive).await;

    let result = plan_at(&factory, &task, week(9, 27), at(9, 27)).await;

    assert_eq!(
        refused_for_containment(result),
        "plan is not within the task's time scope"
    );
}

#[tokio::test]
async fn an_overdue_task_is_still_held_by_its_planned_parent() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project_id = make_project(&factory, &pool).await;
    // An unscoped parent planned into the week of 20 September.
    let parent = create(
        &factory,
        CreateTaskRequest {
            title: "Parent".into(),
            parent_type: "project".into(),
            parent_id: project_id.into(),
            plan: Some(week(9, 20)),
            ..Default::default()
        },
    )
    .await;
    let child = create(
        &factory,
        CreateTaskRequest {
            title: "Overdue child".into(),
            parent_type: "task".into(),
            parent_id: parent.id.clone(),
            time_scope: Some(week(7, 15)),
            on_scope_exit: Some(OnScopeExit::Keep),
            ..Default::default()
        },
    )
    .await;

    let outside_parent = plan_at(&factory, &child, week(9, 27), at(9, 27)).await;
    assert_eq!(
        refused_for_containment(outside_parent),
        "plan is not within the parent task's plan"
    );

    let inside_parent = plan_at(&factory, &child, week(9, 20), at(9, 27))
        .await
        .unwrap();
    assert_eq!(inside_parent.plan, Some(week(9, 20)));
}
