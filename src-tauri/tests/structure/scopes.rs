//! Scopes are derived, not stored (ADR 0009): what that means for the database.
//!
//! The derivation itself — dates, labels, bounds, the key spelling — is unit-tested beside it in
//! `src/scopes/`. These tests hold the storage contract: no calendar table, value keys in the
//! referencing columns, and exact windows registered by the write that stores them.

use crate::helpers;

use chrono::{NaiveDate, NaiveDateTime};

use arlesh_lib::{
    commands::scopes::{exact_scope, part_scope, scope_containing},
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    scopes::{
        key::ScopeKey,
        model::{PartOfDay, ScopeKind},
    },
    tasks::{
        create_task,
        model::{CreateTaskRequest, TimeScope, UpdateTaskRequest},
        update_task,
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
            title: "Scoped work".into(),
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

fn exact_key() -> ScopeKey {
    let at = |text: &str| NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S").unwrap();
    ScopeKey::exact(at("2026-06-20T09:30:00"), at("2026-06-22T14:00:00")).unwrap()
}

async fn exact_rows(pool: &sqlx::SqlitePool) -> Vec<(String, String, String)> {
    sqlx::query_as("SELECT id, start_datetime, end_datetime FROM exact_scopes ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn task_with_window(
    pool: &sqlx::SqlitePool,
    project_id: i64,
    window: TimeScope,
) -> Result<i64, arlesh_lib::tasks::error::TaskError> {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Scoped".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(window),
            ..Default::default()
        },
    )
    .await?;
    db.commit().await.unwrap();
    Ok(task.id)
}

#[tokio::test]
async fn there_is_no_calendar_table() {
    let pool = helpers::test_pool().await;
    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'scopes'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tables, 0, "canonical scopes are derived, never stored");
}

#[tokio::test]
async fn a_task_stores_its_window_as_value_keys() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let week = ScopeKey::containing(
        ScopeKind::Week,
        NaiveDate::from_ymd_opt(2026, 9, 23).unwrap(),
    )
    .unwrap();

    let task_id = task_with_window(&pool, project_id, TimeScope::single(week))
        .await
        .unwrap();

    let stored: (String, String) =
        sqlx::query_as("SELECT time_scope_start_id, time_scope_end_id FROM tasks WHERE id = ?")
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        stored,
        ("week:2026-09-20".to_string(), "week:2026-09-20".to_string())
    );
    assert!(
        exact_rows(&pool).await.is_empty(),
        "a canonical key needs no row"
    );
}

#[tokio::test]
async fn saving_an_exact_window_registers_it_once() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let first = task_with_window(&pool, project_id, TimeScope::single(exact_key())).await;
    let second = task_with_window(&pool, project_id, TimeScope::single(exact_key())).await;

    assert!(first.is_ok() && second.is_ok());
    assert_eq!(
        exact_rows(&pool).await,
        vec![(
            "exact:2026-06-20T09:30:00/2026-06-22T14:00:00".to_string(),
            "2026-06-20T09:30:00".to_string(),
            "2026-06-22T14:00:00".to_string(),
        )]
    );
}

#[tokio::test]
async fn an_update_that_plans_into_an_exact_window_registers_it() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Plan me".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    update_task(
        &mut db,
        arlesh_lib::tasks::model::TaskId(task.id),
        UpdateTaskRequest {
            plan: Some(Some(TimeScope::single(exact_key()))),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    assert_eq!(exact_rows(&pool).await.len(), 1);
}

#[tokio::test]
async fn an_unregistered_exact_key_is_refused_by_the_schema() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let written = sqlx::query(
        "INSERT INTO tasks (title, parent_type, parent_id, time_scope_start_id, time_scope_end_id,
                            on_scope_exit)
         VALUES ('Raw', 'project', ?, ?, ?, 'keep')",
    )
    .bind(project_id)
    .bind(exact_key())
    .bind(exact_key())
    .execute(&pool)
    .await;

    assert!(
        written.is_err(),
        "an exact key keeps referential integrity: it must be registered before it is stored"
    );
}

#[tokio::test]
async fn a_canonical_key_needs_no_registration() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let day = ScopeKey::day(NaiveDate::from_ymd_opt(2026, 9, 23).unwrap());

    sqlx::query(
        "INSERT INTO tasks (title, parent_type, parent_id, time_scope_start_id, time_scope_end_id,
                            on_scope_exit)
         VALUES ('Raw', 'project', ?, ?, ?, 'keep')",
    )
    .bind(project_id)
    .bind(day)
    .bind(day)
    .execute(&pool)
    .await
    .unwrap();
}

#[test]
fn the_scope_commands_derive_without_a_database() {
    let date = "2026-06-20".to_string();

    let week = scope_containing(ScopeKind::Week, date.clone()).unwrap();
    assert_eq!(week.id.to_string(), "week:2026-06-14");
    assert_eq!(week.end_date, "2026-06-20");

    let night = part_scope(date, PartOfDay::Night).unwrap();
    assert_eq!(night.id.to_string(), "part_of_day:2026-06-20:night");
    assert_eq!(night.end_date, "2026-06-21");

    let exact = exact_scope(
        "2026-06-20T09:30:00".to_string(),
        "2026-06-22T14:00:00".to_string(),
    )
    .unwrap();
    assert_eq!(exact.id, exact_key());
}
