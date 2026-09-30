//! A Task's **due scope** and the **Overdue** flag it drives: an explicit due is held within the
//! task's effective Time Scope, an Unscoped task may carry one of its own, and the flag — no longer
//! a Resolution — is read against the due, whether explicit or derived.

use crate::helpers;

use arlesh_lib::{
    database::session::SessionFactory,
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    scopes::{key::ScopeKey, model::ScopeKind},
    tasks::{
        create_task_at, derive_all_scope_lifecycles,
        error::TaskError,
        lifecycle::{ItemLifecycle, Timing},
        model::{
            CreateTaskRequest, OnScopeExit, Task, TaskArchival, TaskId, TimeScope,
            UpdateTaskRequest,
        },
        update_task_at,
    },
};
use chrono::{NaiveDate, NaiveDateTime};
use helpers::StoredId;

fn date(month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, month, day).unwrap()
}

/// Noon on a day of 2026.
fn at(month: u32, day: u32) -> NaiveDateTime {
    date(month, day).and_hms_opt(12, 0, 0).unwrap()
}

fn week_key(month: u32, day: u32) -> ScopeKey {
    ScopeKey::containing(ScopeKind::Week, date(month, day)).unwrap()
}

/// The Week of 2026 holding `month`/`day`, as a single-scope window.
fn week(month: u32, day: u32) -> TimeScope {
    TimeScope::single(week_key(month, day))
}

/// The Weeks holding `from` through `to`, as one range.
fn weeks(from: (u32, u32), to: (u32, u32)) -> TimeScope {
    TimeScope {
        start_id: week_key(from.0, from.1),
        end_id: week_key(to.0, to.1),
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

/// Creates a task as of 1 July, committing only if the write is accepted.
async fn create(factory: &SessionFactory, request: CreateTaskRequest) -> Result<Task, TaskError> {
    let mut db = factory.begin().await.unwrap();
    let result = create_task_at(&mut db, request, at(7, 1)).await;
    if result.is_ok() {
        db.commit().await.unwrap();
    }
    result
}

/// Applies `request` to `task` as of `now`, committing only if the write is accepted.
async fn update(
    factory: &SessionFactory,
    task: &Task,
    request: UpdateTaskRequest,
    now: NaiveDateTime,
) -> Result<Task, TaskError> {
    let mut db = factory.begin().await.unwrap();
    let result = update_task_at(&mut db, TaskId(task.id.sid()), request, now).await;
    if result.is_ok() {
        db.commit().await.unwrap();
    }
    result
}

/// `task`'s lifecycle entry at `now`.
async fn lifecycle(factory: &SessionFactory, task: &Task, now: NaiveDateTime) -> ItemLifecycle {
    let mut db = factory.connect().await.unwrap();
    derive_all_scope_lifecycles(&mut db, now)
        .await
        .unwrap()
        .into_iter()
        .find(|entry| entry.node_type == "task" && entry.node_id == task.id)
        .unwrap()
}

fn refused_for_containment(result: Result<Task, TaskError>) -> String {
    match result {
        Err(TaskError::ScopeContainment(message)) => message,
        other => panic!("expected a containment refusal, got {other:?}"),
    }
}

/// A task under `parent`, scoped and due as given.
fn request(
    parent: (&str, i64),
    time_scope: Option<TimeScope>,
    on_exit: Option<OnScopeExit>,
    due_scope: Option<TimeScope>,
) -> CreateTaskRequest {
    CreateTaskRequest {
        title: "Due work".into(),
        parent_type: parent.0.into(),
        parent_id: parent.1.into(),
        time_scope,
        on_scope_exit: on_exit,
        due_scope,
        ..Default::default()
    }
}

#[tokio::test]
async fn a_due_outside_the_tasks_own_time_scope_is_refused() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project = make_project(&factory, &pool).await;

    let result = create(
        &factory,
        request(
            ("project", project),
            Some(week(7, 15)),
            Some(OnScopeExit::Keep),
            Some(week(7, 22)),
        ),
    )
    .await;

    assert_eq!(
        refused_for_containment(result),
        "due is not within the task's time scope"
    );
}

#[tokio::test]
async fn a_due_inside_the_time_scope_is_stored_and_can_be_cleared() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project = make_project(&factory, &pool).await;

    let task = create(
        &factory,
        request(
            ("project", project),
            Some(weeks((7, 12), (7, 26))),
            Some(OnScopeExit::Archive),
            Some(week(7, 12)),
        ),
    )
    .await
    .unwrap();
    assert_eq!(task.due_scope, Some(week(7, 12)));

    let cleared = update(
        &factory,
        &task,
        UpdateTaskRequest {
            due_scope: Some(None),
            ..Default::default()
        },
        at(7, 1),
    )
    .await
    .unwrap();
    assert_eq!(cleared.due_scope, None);
}

#[tokio::test]
async fn narrowing_the_time_scope_past_the_due_is_refused() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project = make_project(&factory, &pool).await;
    let task = create(
        &factory,
        request(
            ("project", project),
            Some(weeks((7, 12), (7, 26))),
            Some(OnScopeExit::Keep),
            Some(week(7, 12)),
        ),
    )
    .await
    .unwrap();

    let result = update(
        &factory,
        &task,
        UpdateTaskRequest {
            time_scope: Some(Some(week(7, 26))),
            ..Default::default()
        },
        at(7, 1),
    )
    .await;

    assert_eq!(
        refused_for_containment(result),
        "due is not within the task's time scope"
    );
}

#[tokio::test]
async fn an_unscoped_task_may_carry_a_due_and_is_overdue_once_it_passes() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project = make_project(&factory, &pool).await;
    let task = create(
        &factory,
        request(("project", project), None, None, Some(week(7, 15))),
    )
    .await
    .unwrap();

    let during = lifecycle(&factory, &task, at(7, 15)).await;
    assert!(!during.overdue);

    let after = lifecycle(&factory, &task, at(7, 22)).await;
    assert_eq!(after.timing, Timing::Active);
    assert_eq!(after.resolution, None);
    assert!(after.overdue);
}

#[tokio::test]
async fn a_due_on_a_child_that_inherits_its_window_is_held_to_the_inherited_one() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project = make_project(&factory, &pool).await;
    let parent = create(
        &factory,
        request(
            ("project", project),
            Some(week(7, 15)),
            Some(OnScopeExit::Keep),
            None,
        ),
    )
    .await
    .unwrap();

    let outside = create(
        &factory,
        request(("task", parent.id.sid()), None, None, Some(week(7, 22))),
    )
    .await;
    assert_eq!(
        refused_for_containment(outside),
        "due is not within the task's time scope"
    );

    let inside = create(
        &factory,
        request(("task", parent.id.sid()), None, None, Some(week(7, 15))),
    )
    .await;
    assert!(inside.is_ok());
}

#[tokio::test]
async fn keep_overdue_is_overdue_past_its_window_and_archive_is_not() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project = make_project(&factory, &pool).await;
    let keep = create(
        &factory,
        request(
            ("project", project),
            Some(week(7, 15)),
            Some(OnScopeExit::Keep),
            None,
        ),
    )
    .await
    .unwrap();
    let archive = create(
        &factory,
        request(
            ("project", project),
            Some(week(7, 15)),
            Some(OnScopeExit::Archive),
            None,
        ),
    )
    .await
    .unwrap();

    assert!(lifecycle(&factory, &keep, at(7, 22)).await.overdue);
    assert!(!lifecycle(&factory, &archive, at(7, 22)).await.overdue);
}

#[tokio::test]
async fn a_child_derives_its_due_from_the_window_it_inherits() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project = make_project(&factory, &pool).await;
    let parent = create(
        &factory,
        request(
            ("project", project),
            Some(week(7, 15)),
            Some(OnScopeExit::Keep),
            None,
        ),
    )
    .await
    .unwrap();
    let child = create(
        &factory,
        request(("task", parent.id.sid()), None, None, None),
    )
    .await
    .unwrap();

    assert!(!lifecycle(&factory, &child, at(7, 15)).await.overdue);
    assert!(lifecycle(&factory, &child, at(7, 22)).await.overdue);
}

#[tokio::test]
async fn a_backlogged_task_has_no_default_due_but_an_explicit_one_holds() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project = make_project(&factory, &pool).await;
    let set_aside = create(
        &factory,
        CreateTaskRequest {
            archival: Some(TaskArchival::Backlog),
            ..request(
                ("project", project),
                Some(week(7, 15)),
                Some(OnScopeExit::Keep),
                None,
            )
        },
    )
    .await
    .unwrap();
    let set_aside_with_due = create(
        &factory,
        CreateTaskRequest {
            archival: Some(TaskArchival::Backlog),
            ..request(
                ("project", project),
                Some(week(7, 15)),
                Some(OnScopeExit::Keep),
                Some(week(7, 15)),
            )
        },
    )
    .await
    .unwrap();

    assert!(!lifecycle(&factory, &set_aside, at(7, 22)).await.overdue);
    assert!(
        lifecycle(&factory, &set_aside_with_due, at(7, 22))
            .await
            .overdue
    );
}

#[tokio::test]
async fn a_task_past_an_explicit_due_may_be_planned_outside_its_open_window() {
    // The Plan exemption, keyed on the flag: an Archive task due the week of 12 July, its window
    // running to the end of July, is Overdue on the 20th and may be rescheduled into September.
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let project = make_project(&factory, &pool).await;
    let task = create(
        &factory,
        request(
            ("project", project),
            Some(weeks((7, 12), (7, 26))),
            Some(OnScopeExit::Archive),
            Some(week(7, 12)),
        ),
    )
    .await
    .unwrap();
    let plan_september = || UpdateTaskRequest {
        plan: Some(Some(week(9, 27))),
        ..Default::default()
    };

    let before_due = update(&factory, &task, plan_september(), at(7, 14)).await;
    assert_eq!(
        refused_for_containment(before_due),
        "plan is not within the task's time scope"
    );

    let planned = update(&factory, &task, plan_september(), at(7, 20))
        .await
        .unwrap();
    assert_eq!(planned.plan, Some(week(9, 27)));
    assert_eq!(planned.time_scope, Some(weeks((7, 12), (7, 26))));
}
