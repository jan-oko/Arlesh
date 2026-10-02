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
            AgenticBrief, AgenticStatus, CreateExpectationRequest, CreateTaskRequest,
            ExpectationId, ExpectationStatus, Status, Task, TaskAgentic, TaskId, TaskStatus,
            UpdateExpectationRequest, UpdateTaskRequest,
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
            status: Some(Status::Ordinary(TaskStatus::InProgress)),
            ..Default::default()
        },
    )
    .await
}

fn with_spec(spec: &str) -> Option<AgenticBrief> {
    Some(AgenticBrief {
        priority: Some(arlesh_lib::tasks::model::AgenticPriority::A),
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
            .find(|task| task.id == arlesh_lib::nodes::id::NodeId::Stored(id))
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
async fn an_agentic_task_without_a_spec_cannot_be_claimed_or_taken() {
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

    for id in [bare, blank] {
        assert!(matches!(
            set(&pool, id, agentic(AgenticStatus::OnAgent)).await,
            Err(TaskError::AgenticSpecMissing)
        ));
        assert!(matches!(
            set(&pool, id, agentic(AgenticStatus::Doing)).await,
            Err(TaskError::AgenticSpecMissing)
        ));
    }
}

fn agentic(status: AgenticStatus) -> Status {
    Status::Agentic(status)
}

fn ordinary(status: TaskStatus) -> Status {
    Status::Ordinary(status)
}

async fn set(pool: &sqlx::SqlitePool, id: i64, status: Status) -> Result<Task, TaskError> {
    update(
        pool,
        id,
        UpdateTaskRequest {
            status: Some(status),
            ..Default::default()
        },
    )
    .await
}

#[tokio::test]
async fn a_new_task_holds_the_to_do_of_its_kinds_model() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(&pool, ("project", project), TaskAgentic::Yes, None).await;
    let plain = task(&pool, ("project", project), TaskAgentic::Inherit, None).await;
    let step = task(&pool, ("task", parent), TaskAgentic::Inherit, None).await;

    let read = |id| {
        let pool = pool.clone();
        async move {
            helpers::session_factory(&pool)
                .connect()
                .await
                .unwrap()
                .tasks()
                .get(TaskId(id))
                .await
                .unwrap()
                .status
        }
    };
    assert_eq!(read(parent).await, agentic(AgenticStatus::Todo));
    assert_eq!(read(step).await, agentic(AgenticStatus::Todo));
    assert_eq!(read(plain).await, ordinary(TaskStatus::Todo));
}

#[tokio::test]
async fn started_is_not_an_agentic_status() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Build it"),
    )
    .await;

    assert!(matches!(
        set(&pool, id, ordinary(TaskStatus::Started)).await,
        Err(TaskError::NotAgenticStatus(status)) if status == "started"
    ));
}

#[tokio::test]
async fn on_agent_is_not_an_ordinary_status() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, ("project", project), TaskAgentic::Inherit, None).await;

    assert!(matches!(
        set(&pool, id, agentic(AgenticStatus::OnAgent)).await,
        Err(TaskError::NotOrdinaryStatus(_))
    ));
}

#[tokio::test]
async fn review_is_never_set() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Build it"),
    )
    .await;

    assert!(matches!(
        set(&pool, id, agentic(AgenticStatus::Review)).await,
        Err(TaskError::ReviewIsDerived)
    ));
}

#[tokio::test]
async fn handing_begun_work_between_the_agent_and_the_user_is_not_a_start() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Build it"),
    )
    .await;
    set(&pool, id, agentic(AgenticStatus::OnAgent))
        .await
        .unwrap();
    update(
        &pool,
        id,
        UpdateTaskRequest {
            agentic_brief: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // The work was claimed while it had a Spec; taking it over and handing it back asks nothing.
    let taken = set(&pool, id, agentic(AgenticStatus::Doing)).await.unwrap();
    assert_eq!(taken.status, agentic(AgenticStatus::Doing));
    let handed = set(&pool, id, agentic(AgenticStatus::OnAgent))
        .await
        .unwrap();
    assert_eq!(handed.status, agentic(AgenticStatus::OnAgent));
}

#[tokio::test]
async fn an_agentic_task_with_a_spec_is_claimed() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Build it"),
    )
    .await;

    let claimed = set(&pool, id, agentic(AgenticStatus::OnAgent))
        .await
        .unwrap();

    assert_eq!(claimed.status, agentic(AgenticStatus::OnAgent));
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
            status: Some(agentic(AgenticStatus::Doing)),
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
        set(&pool, step, agentic(AgenticStatus::OnAgent)).await,
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
async fn marking_work_in_progress_agentic_converts_it_to_doing() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(&pool, ("project", project), TaskAgentic::Inherit, None).await;
    start(&pool, id).await.unwrap();

    let marked = update(
        &pool,
        id,
        UpdateTaskRequest {
            agentic: Some(TaskAgentic::Yes),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(marked.status, agentic(AgenticStatus::Doing));

    // An edit naming the status it holds is no start, and so asks for no Spec.
    let renamed = update(
        &pool,
        id,
        UpdateTaskRequest {
            title: Some("Still going".into()),
            status: Some(agentic(AgenticStatus::Doing)),
            ..Default::default()
        },
    )
    .await;
    assert!(renamed.is_ok(), "{renamed:?}");

    // A form that still names the old model's value, with the flag changed in the same write,
    // is converted, not refused: the flag change is the explicit conversion.
    let back = update(
        &pool,
        id,
        UpdateTaskRequest {
            agentic: Some(TaskAgentic::No),
            status: Some(agentic(AgenticStatus::Doing)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(back.status, ordinary(TaskStatus::InProgress));
}

#[tokio::test]
async fn a_flag_change_that_would_strand_a_status_is_refused_naming_the_tasks() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let parent = task(&pool, ("project", project), TaskAgentic::Inherit, None).await;
    let paused = create(
        &pool,
        CreateTaskRequest {
            title: "Paused step".into(),
            parent_type: "task".into(),
            parent_id: parent.into(),
            status: Some(ordinary(TaskStatus::Started)),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
    .sid();
    let going = create(
        &pool,
        CreateTaskRequest {
            title: "Going step".into(),
            parent_type: "task".into(),
            parent_id: parent.into(),
            status: Some(ordinary(TaskStatus::InProgress)),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
    .sid();

    let refused = update(
        &pool,
        parent,
        UpdateTaskRequest {
            agentic: Some(TaskAgentic::Yes),
            ..Default::default()
        },
    )
    .await;
    match refused {
        Err(TaskError::KindConversion(named)) => {
            assert!(named.contains("Paused step"), "{named}");
            assert!(!named.contains("Going step"), "{named}");
        }
        other => panic!("expected a refusal naming the stranded task, got {other:?}"),
    }
    // Nothing landed: the parent is still not agentic, and its steps keep their model.
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert_eq!(db.tasks().get(TaskId(parent)).await.unwrap().agentic, None);
    assert_eq!(
        db.tasks().get(TaskId(going)).await.unwrap().status,
        ordinary(TaskStatus::InProgress)
    );
    drop(db);

    // Settled first, the same change converts every step that inherits it.
    set(&pool, paused, ordinary(TaskStatus::InProgress))
        .await
        .unwrap();
    update(
        &pool,
        parent,
        UpdateTaskRequest {
            agentic: Some(TaskAgentic::Yes),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    for step in [paused, going] {
        assert_eq!(
            db.tasks().get(TaskId(step)).await.unwrap().status,
            agentic(AgenticStatus::Doing)
        );
    }
}

#[tokio::test]
async fn a_move_under_an_agentic_task_converts_or_is_refused() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let agentic_parent = task(&pool, ("project", project), TaskAgentic::Yes, None).await;
    let moving = task(&pool, ("project", project), TaskAgentic::Inherit, None).await;
    start(&pool, moving).await.unwrap();

    let moved = update(
        &pool,
        moving,
        UpdateTaskRequest {
            parent_type: Some("task".into()),
            parent_id: Some(agentic_parent.into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(moved.status, agentic(AgenticStatus::Doing));

    let paused = task(&pool, ("project", project), TaskAgentic::Inherit, None).await;
    set(&pool, paused, ordinary(TaskStatus::Started))
        .await
        .unwrap();
    assert!(matches!(
        update(
            &pool,
            paused,
            UpdateTaskRequest {
                parent_type: Some("task".into()),
                parent_id: Some(agentic_parent.into()),
                ..Default::default()
            },
        )
        .await,
        Err(TaskError::KindConversion(_))
    ));
}

#[tokio::test]
async fn a_task_created_under_an_agentic_one_holds_the_agentic_model() {
    // The path that names a status is a duplicate: a copy of work underway is not the work
    // starting, and a copy made under an agentic Task holds its counterpart there.
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
            status: Some(ordinary(TaskStatus::InProgress)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(created.status, agentic(AgenticStatus::Doing));

    let paused = create(
        &pool,
        CreateTaskRequest {
            title: "Paused".into(),
            parent_type: "task".into(),
            parent_id: parent.into(),
            status: Some(ordinary(TaskStatus::Started)),
            ..Default::default()
        },
    )
    .await;
    assert!(matches!(paused, Err(TaskError::KindConversion(_))));
}

#[tokio::test]
async fn a_question_makes_an_on_agent_task_read_review_until_it_is_answered() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let id = task(
        &pool,
        ("project", project),
        TaskAgentic::Yes,
        with_spec("Build it"),
    )
    .await;
    set(&pool, id, agentic(AgenticStatus::OnAgent))
        .await
        .unwrap();
    let served = |pool: sqlx::SqlitePool| async move {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let now = chrono::Local::now().naive_local();
        arlesh_lib::mindmap::load(&mut db, now)
            .await
            .unwrap()
            .tasks
            .into_iter()
            .find(|task| task.id.sid() == id)
            .unwrap()
            .status
    };
    assert_eq!(served(pool.clone()).await, agentic(AgenticStatus::OnAgent));

    let question = wait_under(&pool, ("task", id)).await.unwrap();
    assert_eq!(served(pool.clone()).await, agentic(AgenticStatus::Review));
    // The row still holds On Agent: Review is derived, never stored.
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert_eq!(
        db.tasks().get(TaskId(id)).await.unwrap().status,
        agentic(AgenticStatus::OnAgent)
    );
    drop(db);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_expectation(
        &mut db,
        ExpectationId(question.id.sid()),
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            answer: Some(Some("Blue.".into())),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    assert_eq!(served(pool.clone()).await, agentic(AgenticStatus::OnAgent));
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
            answer: Some(Some("Blue.".into())),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(answered.status, ExpectationStatus::Released);
    assert_eq!(answered.answer.as_deref(), Some("Blue."));
}
