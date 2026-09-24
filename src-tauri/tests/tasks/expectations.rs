//! Expectations against a real database: the row, the dependency edges aimed at it, the virtual
//! block reason it gives a Task, its lifecycle entry, the subtree delete and the retype paths that
//! have to carry one.

use crate::helpers;

use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    infos::model::CreateInfoRequest,
    scopes::model::ScopeKind,
    tasks::{
        add_task_dependency, complete_expectation_check, create_expectation, create_task,
        delete_expectation, delete_task, derive_all_scope_lifecycles,
        error::TaskError,
        get_task_with_blockers,
        lifecycle::{Archival, Resolution, Timing},
        model::{
            CreateExpectationRequest, CreateTaskRequest, Dependency, DurationSpec, Expectation,
            ExpectationArchival, ExpectationId, ExpectationStatus, TaskId, TimeScope,
            UpdateExpectationRequest,
        },
        reopen_expectation_check,
        retype::{apply_retype, plan_node_retype, RetypeKind, StrandedChildren},
        update_expectation,
        waits::{derive_wait_windows, ExpectationCheck},
    },
};
use chrono::{NaiveDate, NaiveDateTime};
use helpers::StoredId;

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

async fn day(_pool: &sqlx::SqlitePool, date: NaiveDate) -> TimeScope {
    let scope = arlesh_lib::scopes::model::Scope::containing(ScopeKind::Day, date).unwrap();
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
            parent_id: parent_id.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    task.id.sid()
}

async fn expectation(
    pool: &sqlx::SqlitePool,
    parent_type: &str,
    parent_id: i64,
    check_every: Option<DurationSpec>,
) -> Expectation {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let expectation = create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Reviewer replies".into(),
            parent_type: parent_type.into(),
            parent_id: parent_id.into(),
            check_starting: check_every.as_ref().map(|_| at("2026-07-03T09:00:00")),
            check_every,
            time_scope: None,
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

fn every(n: i64, kind: &str) -> DurationSpec {
    DurationSpec {
        n,
        kind: kind.to_string(),
    }
}

#[tokio::test]
async fn a_new_expectation_is_pending_live_and_unchecked_unless_given_a_check_every() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let bare = expectation(&pool, "project", project, None).await;
    assert_eq!(bare.status, ExpectationStatus::Pending);
    assert_eq!(bare.archival, ExpectationArchival::Live);
    assert!(bare.check_every.is_none() && bare.check_starting.is_none());

    let checked = expectation(&pool, "project", project, Some(every(3, "day"))).await;
    assert_eq!(checked.check_every, Some(every(3, "day")));
    assert_eq!(checked.check_starting, Some(at("2026-07-03T09:00:00")));

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let listed = db.expectations().list().await.unwrap();
    assert_eq!(listed.len(), 2);
}

#[tokio::test]
async fn completing_a_check_records_it_and_moves_the_next_one_interval_on() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let wait = expectation(&pool, "project", project, Some(every(3, "day"))).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let checked = complete_expectation_check(
        &mut db,
        ExpectationId(wait.id.sid()),
        at("2026-07-09T18:00:00"),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    assert_eq!(checked.last_check_at, Some(at("2026-07-09T18:00:00")));
    assert_eq!(checked.status, ExpectationStatus::Pending);

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    // Done on the 9th, the check stays as a done one; the next is not due until the 12th, so until
    // then there is no open check.
    let before = derive_wait_windows(&mut db, at("2026-07-12T09:00:00"))
        .await
        .unwrap()
        .expectation_checks;
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].due_at, at("2026-07-03T09:00:00"));
    assert_eq!(before[0].resolved_at, Some(at("2026-07-09T18:00:00")));
    let windows = derive_wait_windows(&mut db, at("2026-07-12T19:00:00"))
        .await
        .unwrap();
    let due = open_check(&windows.expectation_checks).expect("the next check is due");
    assert_eq!(due.expectation_id, wait.id);
    let day = due.due.start_id.scope();
    assert_eq!(day.start_date, "2026-07-12");
    drop(db);

    // Released, it is not checked on any more, and a check aimed at it says so.
    update(
        &pool,
        wait.id.sid(),
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let refused = complete_expectation_check(
        &mut db,
        ExpectationId(wait.id.sid()),
        at("2026-07-12T09:00:00"),
    )
    .await;
    assert!(matches!(refused, Err(TaskError::NoCheckDue)));
    drop(db);
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let checks = derive_wait_windows(&mut db, at("2026-07-20T09:00:00"))
        .await
        .unwrap()
        .expectation_checks;
    assert!(open_check(&checks).is_none());
    assert_eq!(checks.len(), 1, "the done check stays");
}

/// The one check that is due and open, among a wait's checks.
fn open_check(checks: &[ExpectationCheck]) -> Option<&ExpectationCheck> {
    checks.iter().find(|check| check.resolved_at.is_none())
}

#[tokio::test]
async fn reopening_the_latest_check_brings_it_back_and_the_next_goes() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let wait = expectation(&pool, "project", project, Some(every(3, "day"))).await;
    for day in ["2026-07-04T10:00:00", "2026-07-08T10:00:00"] {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        complete_expectation_check(&mut db, ExpectationId(wait.id.sid()), at(day))
            .await
            .unwrap();
        db.commit().await.unwrap();
    }
    // Due the 3rd (done the 4th), then the 7th (done the 8th); the next is due the 11th.
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let checks = derive_wait_windows(&mut db, at("2026-07-11T12:00:00"))
        .await
        .unwrap()
        .expectation_checks;
    assert_eq!(checks.len(), 3);
    assert_eq!(
        open_check(&checks).map(|check| check.due_at),
        Some(at("2026-07-11T10:00:00"))
    );
    drop(db);

    // Only the latest can be taken back.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let older = reopen_expectation_check(
        &mut db,
        ExpectationId(wait.id.sid()),
        at("2026-07-03T09:00:00"),
    )
    .await;
    assert!(matches!(older, Err(TaskError::CheckNotReopenable)));
    reopen_expectation_check(
        &mut db,
        ExpectationId(wait.id.sid()),
        at("2026-07-07T10:00:00"),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let checks = derive_wait_windows(&mut db, at("2026-07-11T12:00:00"))
        .await
        .unwrap()
        .expectation_checks;
    assert_eq!(checks.len(), 2, "one done, and the reopened one open again");
    assert_eq!(
        open_check(&checks).map(|check| check.due_at),
        Some(at("2026-07-07T10:00:00"))
    );
}

#[tokio::test]
async fn the_lifecycle_entries_time_the_next_check_and_carry_the_archive() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let late = expectation(&pool, "project", project, Some(every(3, "day"))).await;
    let archived = expectation(&pool, "project", project, None).await;
    update(
        &pool,
        archived.id.sid(),
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
    let entry = |node_type: &str, id: arlesh_lib::nodes::id::NodeId| {
        lifecycles
            .iter()
            .find(|l| l.node_type == node_type && l.node_id == id)
            .unwrap()
    };
    // The first check was due on the 3rd, so on the 10th it is overdue. Its entry is filed under
    // the check task's own row.
    let check = arlesh_lib::nodes::key::DerivedKey::Check(arlesh_lib::nodes::key::CheckKey {
        wait: arlesh_lib::tasks::waits::WaitRef::Stored(late.id.sid()),
        due_at: at("2026-07-03T09:00:00"),
    })
    .node_id();
    assert_eq!(entry("task", check.clone()).timing, Timing::Lapsed);
    assert_eq!(entry("task", check).resolution, Some(Resolution::Overdue));
    // The wait's own entry times its (absent) Time Scope and carries its archive.
    assert_eq!(entry("expectation", late.id.clone()).timing, Timing::Active);
    assert_eq!(
        entry("expectation", archived.id.clone()).timing,
        Timing::Active
    );
    assert_eq!(
        entry("expectation", archived.id.clone()).archival,
        Archival::Archived
    );
}

#[tokio::test]
async fn deleting_an_expectation_takes_its_notes_and_the_edges_aimed_at_it() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let task_id = task(&pool, "project", project).await;
    let wait = expectation(&pool, "project", project, None).await;
    depend(&pool, task_id, wait.id.sid()).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    db.infos()
        .create(CreateInfoRequest {
            body: "asked on Monday".into(),
            details: None,
            parent_type: "expectation".into(),
            parent_id: wait.id.clone(),
            position: 0,
        })
        .await
        .unwrap();
    delete_expectation(&mut db, ExpectationId(wait.id.sid()))
        .await
        .unwrap();
    db.commit().await.unwrap();

    assert_eq!(inbound_edges(&pool, wait.id.sid()).await, 0);
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
    depend(&pool, dependent, wait.id.sid()).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    delete_task(&mut db, TaskId(parent)).await.unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    assert!(matches!(
        db.expectations().get(ExpectationId(wait.id.sid())).await,
        Err(TaskError::ExpectationNotFound(_))
    ));
    // The pool holds one connection: give it back before asking on another.
    drop(db);
    assert_eq!(inbound_edges(&pool, wait.id.sid()).await, 0);
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
    let moved = db
        .expectations()
        .get(ExpectationId(wait.id.sid()))
        .await
        .unwrap();
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
    let moved = db
        .expectations()
        .get(ExpectationId(wait.id.sid()))
        .await
        .unwrap();
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
    assert!(db
        .expectations()
        .get(ExpectationId(wait.id.sid()))
        .await
        .is_err());
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
        wait.id.sid(),
        UpdateExpectationRequest {
            parent_type: Some("task".into()),
            parent_id: Some(parent.into()),
            title: Some("Build finishes".into()),
            is_private: Some(true),
            position: Some(3),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let moved = db
        .expectations()
        .get(ExpectationId(wait.id.sid()))
        .await
        .unwrap();
    assert_eq!(
        (moved.parent_type.as_str(), moved.parent_id.sid()),
        ("task", parent)
    );
    assert_eq!(moved.title, "Build finishes");
    assert!(moved.is_private);
    assert_eq!(moved.position, 3);
}

#[tokio::test]
async fn a_wait_carries_tags_and_a_time_scope_of_its_own() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let tag: i64 = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: "waiting".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(project),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id;
    let window = day(&pool, NaiveDate::from_ymd_opt(2026, 7, 3).unwrap()).await;
    let wait = expectation(&pool, "project", project, None).await;
    update(
        &pool,
        wait.id.sid(),
        UpdateExpectationRequest {
            time_scope: Some(Some(window.clone())),
            ..Default::default()
        },
    )
    .await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    db.expectations()
        .add_tag(ExpectationId(wait.id.sid()), tag)
        .await
        .unwrap();
    let read = db
        .expectations()
        .get(ExpectationId(wait.id.sid()))
        .await
        .unwrap();
    assert_eq!(read.tag_ids, [tag]);
    assert_eq!(read.time_scope, Some(window));
    db.expectations()
        .remove_tag(ExpectationId(wait.id.sid()), tag)
        .await
        .unwrap();
    let listed = db.expectations().list().await.unwrap();
    assert!(listed[0].tag_ids.is_empty());
}

#[tokio::test]
async fn a_wait_whose_window_escapes_its_parents_is_refused() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let july = day(&pool, NaiveDate::from_ymd_opt(2026, 7, 3).unwrap()).await;
    let august = day(&pool, NaiveDate::from_ymd_opt(2026, 8, 3).unwrap()).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let parent = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Scoped".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            time_scope: Some(july),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let refused = create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Too late".into(),
            parent_type: "task".into(),
            parent_id: parent.id.clone(),
            check_every: None,
            check_starting: None,
            time_scope: Some(august),
        },
    )
    .await;
    assert!(matches!(refused, Err(TaskError::ScopeContainment(_))));
}

#[tokio::test]
async fn no_check_task_exists_before_starting_and_none_can_be_completed() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    // "Tomorrow", as the editor sends it: the start of that Day, at the 02:00 boundary.
    let wait = create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Reviewer replies".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            check_every: Some(every(2, "day")),
            check_starting: Some(at("2026-07-20T02:00:00")),
            time_scope: None,
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    for before in ["2026-07-19T12:00:00", "2026-07-20T01:59:00"] {
        assert!(
            derive_wait_windows(&mut db, at(before))
                .await
                .unwrap()
                .expectation_checks
                .is_empty(),
            "no check at {before}"
        );
    }
    let windows = derive_wait_windows(&mut db, at("2026-07-20T02:00:00"))
        .await
        .unwrap();
    let day = windows.expectation_checks[0].due.start_id.scope();
    assert_eq!(day.start_date, "2026-07-20");
    drop(db);

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let early = complete_expectation_check(
        &mut db,
        ExpectationId(wait.id.sid()),
        at("2026-07-19T12:00:00"),
    )
    .await;
    assert!(matches!(early, Err(TaskError::NoCheckDue)));
}

#[tokio::test]
async fn an_explicit_null_in_the_payload_stops_the_checks() {
    let pool = helpers::test_pool().await;
    let project = make_project(&pool).await;
    let wait = expectation(&pool, "project", project, Some(every(3, "day"))).await;
    // Exactly what the editor sends over IPC: the key present, its value null.
    let request: UpdateExpectationRequest = serde_json::from_value(
        serde_json::json!({ "title": "Reviewer replies", "check_every": null }),
    )
    .unwrap();
    update(&pool, wait.id.sid(), request).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let read = db
        .expectations()
        .get(ExpectationId(wait.id.sid()))
        .await
        .unwrap();
    assert!(read.check_every.is_none());
    assert!(derive_wait_windows(&mut db, at("2026-07-20T09:00:00"))
        .await
        .unwrap()
        .expectation_checks
        .is_empty());
}
