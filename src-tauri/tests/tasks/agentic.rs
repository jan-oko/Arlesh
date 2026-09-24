//! Agentic as an object: the brief a Task carries, the Spec a Task that reads as Agentic needs
//! before it starts, and the agentic waits that may hang only under one.

use crate::helpers;
use helpers::StoredId;

use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    tasks::{
        create_expectation, create_task,
        error::TaskError,
        model::{
            AgenticBrief, CreateExpectationRequest, CreateTaskRequest, ExpectationId,
            ExpectationStatus, Task, TaskAgentic, TaskId, TaskStatus, UpdateExpectationRequest,
            UpdateTaskRequest,
        },
        update_expectation, update_task,
    },
};

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
            title: "Agents".into(),
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

async fn create(pool: &sqlx::SqlitePool, request: CreateTaskRequest) -> Result<Task, TaskError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let created = create_task(&mut db, request).await;
    if created.is_ok() {
        db.commit().await.unwrap();
    }
    created
}

async fn task(
    pool: &sqlx::SqlitePool,
    parent: (&str, i64),
    agentic: TaskAgentic,
    brief: Option<AgenticBrief>,
) -> i64 {
    create(
        pool,
        CreateTaskRequest {
            title: "Work".into(),
            parent_type: parent.0.into(),
            parent_id: parent.1.into(),
            agentic: Some(agentic),
            agentic_brief: brief,
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
    .sid()
}

async fn update(
    pool: &sqlx::SqlitePool,
    id: i64,
    request: UpdateTaskRequest,
) -> Result<Task, TaskError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let updated = update_task(&mut db, TaskId(id), request).await;
    if updated.is_ok() {
        db.commit().await.unwrap();
    }
    updated
}

async fn start(pool: &sqlx::SqlitePool, id: i64) -> Result<Task, TaskError> {
    update(
        pool,
        id,
        UpdateTaskRequest {
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        },
    )
    .await
}

fn with_spec(spec: &str) -> Option<AgenticBrief> {
    Some(AgenticBrief {
        priority: Some(1),
        spec: spec.into(),
        design: "Reuse the modal".into(),
        acceptance: "It opens from the gear".into(),
        notes: "See Arlesh-izq".into(),
    })
}

async fn wait_under(
    pool: &sqlx::SqlitePool,
    parent: (&str, i64),
) -> Result<arlesh_lib::tasks::model::Expectation, TaskError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let created = create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Which colour?".into(),
            parent_type: parent.0.into(),
            parent_id: parent.1.into(),
            agentic: true,
            agentic_note: Some("Red or blue for the badge?".into()),
            ..Default::default()
        },
    )
    .await;
    if created.is_ok() {
        db.commit().await.unwrap();
    }
    created
}

#[tokio::test]
async fn a_brief_is_stored_read_back_and_removed() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Build it"),
    )
    .await;

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert_eq!(
        db.tasks().get(TaskId(id)).await.unwrap().agentic_brief,
        with_spec("Build it")
    );
    let listed = db.tasks().list().await.unwrap();
    assert_eq!(
        listed
            .iter()
            .find(|task| task.id == id.into())
            .and_then(|task| task.agentic_brief.clone()),
        with_spec("Build it")
    );
    drop(db);

    let cleared = update(
        &pool,
        id,
        UpdateTaskRequest {
            agentic_brief: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(cleared.agentic_brief, None);
}

#[tokio::test]
async fn an_edit_elsewhere_leaves_the_brief_alone() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Build it"),
    )
    .await;

    let renamed = update(
        &pool,
        id,
        UpdateTaskRequest {
            title: Some("Renamed".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(renamed.agentic_brief, with_spec("Build it"));
}

#[tokio::test]
async fn a_priority_past_p4_is_refused() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, ("project", project), TaskAgentic::Yes, None).await;

    let refused = update(
        &pool,
        id,
        UpdateTaskRequest {
            agentic_brief: Some(Some(AgenticBrief {
                priority: Some(7),
                ..Default::default()
            })),
            ..Default::default()
        },
    )
    .await;

    assert!(matches!(
        refused,
        Err(TaskError::AgenticPriorityOutOfRange(7))
    ));
}

#[tokio::test]
async fn an_agentic_task_without_a_spec_cannot_start() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let bare = task(&pool, ("project", project), TaskAgentic::Yes, None).await;
    let blank = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("   "),
    )
    .await;

    assert!(matches!(
        start(&pool, bare).await,
        Err(TaskError::AgenticSpecMissing)
    ));
    assert!(matches!(
        start(&pool, blank).await,
        Err(TaskError::AgenticSpecMissing)
    ));
}

#[tokio::test]
async fn an_agentic_task_with_a_spec_starts() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Build it"),
    )
    .await;

    let started = start(&pool, id).await.unwrap();

    assert_eq!(started.status, TaskStatus::InProgress.as_str());
}

#[tokio::test]
async fn a_spec_given_in_the_same_write_lets_it_start() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, ("project", project), TaskAgentic::Yes, None).await;

    let started = update(
        &pool,
        id,
        UpdateTaskRequest {
            status: Some(TaskStatus::InProgress),
            agentic_brief: Some(with_spec("Build it")),
            ..Default::default()
        },
    )
    .await;

    assert!(started.is_ok(), "{started:?}");
}

#[tokio::test]
async fn a_task_that_inherits_agentic_needs_a_spec_too() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Umbrella"),
    )
    .await;
    let step = task(&pool, ("task", parent), TaskAgentic::Inherit, None).await;

    assert!(matches!(
        start(&pool, step).await,
        Err(TaskError::AgenticSpecMissing)
    ));
}

#[tokio::test]
async fn an_explicit_not_agentic_under_an_agentic_task_starts_without_one() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Umbrella"),
    )
    .await;
    let step = task(&pool, ("task", parent), TaskAgentic::No, None).await;

    assert!(start(&pool, step).await.is_ok());
}

#[tokio::test]
async fn a_task_that_is_not_agentic_starts_without_a_spec() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, ("project", project), TaskAgentic::Inherit, None).await;

    assert!(start(&pool, id).await.is_ok());
}

#[tokio::test]
async fn editing_an_agentic_task_already_in_progress_is_not_a_start() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, ("project", project), TaskAgentic::Inherit, None).await;
    start(&pool, id).await.unwrap();
    update(
        &pool,
        id,
        UpdateTaskRequest {
            agentic: Some(TaskAgentic::Yes),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let renamed = update(
        &pool,
        id,
        UpdateTaskRequest {
            title: Some("Still going".into()),
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        },
    )
    .await;

    assert!(renamed.is_ok(), "{renamed:?}");
}

#[tokio::test]
async fn creating_a_task_already_in_progress_is_not_a_start() {
    // The path that does this is a duplicate: a copy of work underway is not the work starting.
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Umbrella"),
    )
    .await;

    let created = create(
        &pool,
        CreateTaskRequest {
            title: "Underway".into(),
            parent_type: "task".into(),
            parent_id: parent.into(),
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        },
    )
    .await;

    assert!(created.is_ok(), "{created:?}");
}

#[tokio::test]
async fn an_agentic_wait_hangs_under_an_agentic_task() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, ("project", project), TaskAgentic::Yes, None).await;

    let wait = wait_under(&pool, ("task", id)).await.unwrap();

    assert!(wait.agentic);
    assert_eq!(
        wait.agentic_note.as_deref(),
        Some("Red or blue for the badge?")
    );
}

#[tokio::test]
async fn an_agentic_wait_anywhere_else_is_refused() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let plain = task(&pool, ("project", project), TaskAgentic::Inherit, None).await;

    for parent in [("task", plain), ("project", project)] {
        assert!(
            matches!(
                wait_under(&pool, parent).await,
                Err(TaskError::AgenticWaitOutsideAgenticTask)
            ),
            "{parent:?}"
        );
    }
}

#[tokio::test]
async fn an_agentic_wait_can_still_be_answered_after_its_task_stops_being_agentic() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, ("project", project), TaskAgentic::Yes, None).await;
    let wait = wait_under(&pool, ("task", id)).await.unwrap();
    update(
        &pool,
        id,
        UpdateTaskRequest {
            agentic: Some(TaskAgentic::No),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let answered = update_expectation(
        &mut db,
        ExpectationId(wait.id.sid()),
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            agentic_note: Some(Some("Red or blue for the badge?\nBlue.".into())),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(answered.status, ExpectationStatus::Released);
    assert!(answered
        .agentic_note
        .is_some_and(|note| note.ends_with("Blue.")));
}
