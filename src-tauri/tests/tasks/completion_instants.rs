//! Completion instants (Task 199, migration 0089): when a Goal was achieved, a wait released and a
//! Commitment's verdict recorded — written on the way in, kept while it stays so, and cleared when
//! it is taken back.

use crate::helpers;

use arlesh_lib::{
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    scopes::model::ScopeKind,
    tasks::{
        create_commitment, create_expectation, create_goal,
        model::{
            CommitmentId, CreateCommitmentRequest, CreateExpectationRequest, CreateGoalRequest,
            ExpectationId, ExpectationStatus, GoalId, GoalStatus, TimeScope,
            UpdateCommitmentRequest, UpdateExpectationRequest, UpdateGoalRequest, Verdict,
        },
        update_commitment, update_expectation, update_goal,
    },
};
use helpers::StoredId;

async fn project(pool: &sqlx::SqlitePool) -> i64 {
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
            title: "Instants".into(),
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

/// The instant column `column` of row `id` in `table`.
async fn instant(pool: &sqlx::SqlitePool, table: &str, column: &str, id: i64) -> Option<String> {
    sqlx::query_scalar(&format!("SELECT {column} FROM {table} WHERE id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn achieving_a_goal_records_when_and_reopening_clears_it() {
    let pool = helpers::test_pool().await;
    let parent = project(&pool).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Ship".into(),
            parent_type: "project".into(),
            parent_id: parent.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let id = goal.id.sid();
    let achieve = || UpdateGoalRequest {
        status: Some(GoalStatus::Achieved),
        ..Default::default()
    };
    update_goal(&mut db, GoalId(id), achieve()).await.unwrap();
    db.commit().await.unwrap();
    let first = instant(&pool, "goals", "achieved_at", id).await;
    assert!(first.is_some(), "achieved records when");

    sqlx::query("UPDATE goals SET achieved_at = '2026-09-01T10:00:00' WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_goal(&mut db, GoalId(id), achieve()).await.unwrap();
    db.commit().await.unwrap();
    assert_eq!(
        instant(&pool, "goals", "achieved_at", id).await.as_deref(),
        Some("2026-09-01T10:00:00"),
        "saving it achieved again keeps the instant"
    );

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_goal(
        &mut db,
        GoalId(id),
        UpdateGoalRequest {
            status: Some(GoalStatus::Active),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    assert_eq!(instant(&pool, "goals", "achieved_at", id).await, None);
}

#[tokio::test]
async fn a_verdict_records_when_and_unresolved_clears_it() {
    let pool = helpers::test_pool().await;
    let parent = project(&pool).await;
    let scope = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        chrono::NaiveDate::from_ymd_opt(2026, 9, 30).unwrap(),
    )
    .unwrap();
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let commitment = create_commitment(
        &mut db,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: parent.into(),
            time_scope: Some(TimeScope {
                start_id: scope.id,
                end_id: scope.id,
                duration: None,
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let id = commitment.id.sid();
    assert_eq!(instant(&pool, "commitments", "verdict_at", id).await, None);
    let verdict = |verdict| UpdateCommitmentRequest {
        verdict: Some(verdict),
        ..Default::default()
    };
    update_commitment(&mut db, CommitmentId(id), verdict(Verdict::Broken))
        .await
        .unwrap();
    db.commit().await.unwrap();
    assert!(
        instant(&pool, "commitments", "verdict_at", id)
            .await
            .is_some(),
        "Broken is a verdict too"
    );

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_commitment(&mut db, CommitmentId(id), verdict(Verdict::Unresolved))
        .await
        .unwrap();
    db.commit().await.unwrap();
    assert_eq!(instant(&pool, "commitments", "verdict_at", id).await, None);
}

#[tokio::test]
async fn releasing_a_wait_records_when_and_pending_clears_it() {
    let pool = helpers::test_pool().await;
    let parent = project(&pool).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let wait = create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Reply".into(),
            parent_type: "project".into(),
            parent_id: parent.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let id = wait.id.sid();
    let status = |status| UpdateExpectationRequest {
        status: Some(status),
        ..Default::default()
    };
    update_expectation(
        &mut db,
        ExpectationId(id),
        status(ExpectationStatus::Released),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    assert!(instant(&pool, "expectations", "released_at", id)
        .await
        .is_some());

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_expectation(
        &mut db,
        ExpectationId(id),
        status(ExpectationStatus::Pending),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    assert_eq!(
        instant(&pool, "expectations", "released_at", id).await,
        None
    );
}
