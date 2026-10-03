//! **Plan inheritance** (`docs/spec/time-scopes.md`): a Task with no Plan of its own reads its
//! nearest planned ancestor's, clipped to its own Time Scope; a child's own Plan sits inside the one
//! it inherits; a write that leaves a Task outside or with nothing is refused, naming it; and a new
//! Plan above settles the Tasks below as the clamp-or-cancel prompt answered, in the same write.

use crate::helpers;

use arlesh_lib::{
    database::session::SessionFactory,
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    error::AppError,
    mindmap::{load, rules::plans::PlanAudit},
    nodes::write,
    scopes::{key::ScopeKey, model::ScopeKind},
    tasks::{
        error::TaskError,
        model::{CreateTaskRequest, DescendantPlans, Task, TimeScope, UpdateTaskRequest},
        rules::plan_inheritance::{EffectivePlan, PlanConflict},
    },
};
use chrono::{NaiveDate, NaiveDateTime};

fn date(month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, month, day).unwrap()
}

/// Noon on 1 October 2026, before every window below.
fn now() -> NaiveDateTime {
    date(10, 1).and_hms_opt(12, 0, 0).unwrap()
}

fn single(kind: ScopeKind, month: u32, day: u32) -> TimeScope {
    TimeScope::single(ScopeKey::containing(kind, date(month, day)).unwrap())
}

fn week(month: u32, day: u32) -> TimeScope {
    single(ScopeKind::Week, month, day)
}

fn day(month: u32, day: u32) -> TimeScope {
    single(ScopeKind::Day, month, day)
}

async fn project(factory: &SessionFactory, pool: &sqlx::SqlitePool) -> i64 {
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

/// Creates a Task through the guarded writer, committing only if it is accepted.
async fn create(factory: &SessionFactory, request: CreateTaskRequest) -> Result<Task, AppError> {
    let mut db = factory.begin().await.unwrap();
    let created = write::create_task(&mut db, request, now()).await;
    if created.is_ok() {
        db.commit().await.unwrap();
    }
    created
}

/// Writes `request` to `task`, settling the Tasks below as `descendants` says, committing only if
/// it is accepted.
async fn update(
    factory: &SessionFactory,
    task: &Task,
    request: UpdateTaskRequest,
    descendants: Option<DescendantPlans>,
) -> Result<Task, AppError> {
    let mut db = factory.begin().await.unwrap();
    let written = write::plan_task(&mut db, &task.id, request, now(), descendants).await;
    if written.is_ok() {
        db.commit().await.unwrap();
    }
    written
}

fn plan(plan: TimeScope) -> UpdateTaskRequest {
    UpdateTaskRequest {
        plan: Some(Some(plan)),
        ..Default::default()
    }
}

async fn plans(factory: &SessionFactory) -> PlanAudit {
    let mut db = factory.begin().await.unwrap();
    let board = load(&mut db, now()).await.unwrap();
    db.commit().await.unwrap();
    board.plans
}

fn key(task: &Task) -> String {
    format!("task-{}", task.id)
}

fn refusal(result: Result<Task, AppError>) -> String {
    match result {
        Err(AppError::Task(TaskError::ScopeContainment(message))) => message,
        other => panic!("expected a containment refusal, got {other:?}"),
    }
}

/// A parent planned into the week of 4 October, under a project.
async fn planned_parent(factory: &SessionFactory, pool: &sqlx::SqlitePool) -> Task {
    create(
        factory,
        CreateTaskRequest {
            title: "Parent".into(),
            parent_type: "project".into(),
            parent_id: project(factory, pool).await.into(),
            plan: Some(week(10, 4)),
            ..Default::default()
        },
    )
    .await
    .unwrap()
}

fn child_of(parent: &Task, title: &str) -> CreateTaskRequest {
    CreateTaskRequest {
        title: title.into(),
        parent_type: "task".into(),
        parent_id: parent.id.clone(),
        ..Default::default()
    }
}

#[tokio::test]
async fn a_child_reads_its_parents_plan_until_it_sets_its_own() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let parent = planned_parent(&factory, &pool).await;
    let child = create(&factory, child_of(&parent, "Child")).await.unwrap();

    let audit = plans(&factory).await;
    assert_eq!(
        audit.readings[&key(&child)].effective,
        EffectivePlan::Inherited {
            plan: week(10, 4),
            source: key(&parent)
        }
    );

    update(&factory, &child, plan(day(10, 6)), None)
        .await
        .unwrap();
    let audit = plans(&factory).await;
    assert_eq!(
        audit.readings[&key(&child)].effective,
        EffectivePlan::Own(day(10, 6))
    );
}

#[tokio::test]
async fn an_own_plan_outside_the_inherited_one_is_refused() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let parent = planned_parent(&factory, &pool).await;
    let child = create(&factory, child_of(&parent, "Child")).await.unwrap();

    let message = refusal(update(&factory, &child, plan(day(10, 12)), None).await);
    assert!(message.contains("plan"), "{message}");
}

#[tokio::test]
async fn a_window_away_from_the_inherited_plan_is_refused_naming_the_task() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let parent = planned_parent(&factory, &pool).await;
    let child = create(&factory, child_of(&parent, "Away")).await.unwrap();

    let narrowed = UpdateTaskRequest {
        time_scope: Some(Some(week(10, 11))),
        ..Default::default()
    };
    let message = refusal(update(&factory, &child, narrowed, None).await);
    assert!(message.contains("“Away”"), "{message}");
}

#[tokio::test]
async fn moving_a_parents_plan_away_from_a_childs_window_is_refused_naming_the_child() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let parent = planned_parent(&factory, &pool).await;
    create(
        &factory,
        CreateTaskRequest {
            time_scope: Some(week(10, 4)),
            ..child_of(&parent, "Scoped child")
        },
    )
    .await
    .unwrap();

    let message = refusal(update(&factory, &parent, plan(week(10, 11)), None).await);
    assert!(message.contains("“Scoped child”"), "{message}");
}

#[tokio::test]
async fn moving_a_parents_plan_clamps_or_clears_the_child_in_the_same_write() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let parent = planned_parent(&factory, &pool).await;
    let child = create(
        &factory,
        CreateTaskRequest {
            plan: Some(day(10, 5)),
            ..child_of(&parent, "Child")
        },
    )
    .await
    .unwrap();

    // Without an answer, the move would leave the child outside, and is refused.
    refusal(update(&factory, &parent, plan(week(10, 11)), None).await);

    update(
        &factory,
        &parent,
        plan(week(10, 11)),
        Some(DescendantPlans::Clamp),
    )
    .await
    .unwrap();
    let audit = plans(&factory).await;
    assert_eq!(
        audit.readings[&key(&child)].effective,
        EffectivePlan::Own(week(10, 11))
    );

    update(
        &factory,
        &parent,
        plan(week(10, 18)),
        Some(DescendantPlans::Clear),
    )
    .await
    .unwrap();
    let audit = plans(&factory).await;
    assert_eq!(
        audit.readings[&key(&child)].effective,
        EffectivePlan::Inherited {
            plan: week(10, 18),
            source: key(&parent)
        }
    );
}

#[tokio::test]
async fn an_existing_violation_stays_flagged_and_does_not_block_other_writes() {
    let pool = helpers::test_pool().await;
    let factory = helpers::session_factory(&pool);
    let parent = planned_parent(&factory, &pool).await;
    let child = create(
        &factory,
        CreateTaskRequest {
            plan: Some(day(10, 5)),
            ..child_of(&parent, "Child")
        },
    )
    .await
    .unwrap();
    // Written behind the writer's back, as data from before the rule would be.
    sqlx::query("UPDATE tasks SET plan_start_id = ?, plan_end_id = ? WHERE id = ?")
        .bind(r#"{"kind":"day","date":"2026-10-12"}"#)
        .bind(r#"{"kind":"day","date":"2026-10-12"}"#)
        .bind(child.id.stored().unwrap())
        .execute(&pool)
        .await
        .unwrap();

    let audit = plans(&factory).await;
    assert_eq!(
        audit.readings[&key(&child)].conflict,
        Some(PlanConflict::ParentPlan)
    );
    // A sibling written meanwhile is not held to the child's standing violation.
    create(&factory, child_of(&parent, "Sibling"))
        .await
        .unwrap();
    // The child's own next Plan edit must resolve it.
    refusal(update(&factory, &child, plan(day(10, 13)), None).await);
    update(&factory, &child, plan(day(10, 6)), None)
        .await
        .unwrap();
}
