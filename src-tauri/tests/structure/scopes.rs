//! Scopes are derived, not stored (ADR 0009): what that means for the database.
//!
//! The derivation itself — dates, labels, bounds, the key spelling — is unit-tested beside it in
//! `src/scopes/`. These tests hold the storage contract: no scope table, and every referencing
//! column holding a key's one canonical text.

use crate::helpers;
use crate::helpers::StoredId;

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
        model::{CreateTaskRequest, TimeScope},
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
            parent_id: project_id.into(),
            time_scope: Some(window),
            ..Default::default()
        },
    )
    .await?;
    db.commit().await.unwrap();
    Ok(task.id.sid())
}

async fn stored_window(pool: &sqlx::SqlitePool, task_id: i64) -> (String, String) {
    sqlx::query_as("SELECT time_scope_start_id, time_scope_end_id FROM tasks WHERE id = ?")
        .bind(task_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn there_is_no_scope_table() {
    let pool = helpers::test_pool().await;
    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
           AND name IN ('scopes', 'exact_scopes')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tables, 0, "scopes are derived, never stored");
}

#[tokio::test]
async fn a_task_stores_its_window_as_canonical_key_text() {
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

    let week_text = r#"{"kind":"week","date":"2026-09-20"}"#.to_string();
    assert_eq!(
        stored_window(&pool, task_id).await,
        (week_text.clone(), week_text)
    );
}

#[tokio::test]
async fn an_exact_window_is_stored_as_its_value_with_no_row_of_its_own() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task_id = task_with_window(&pool, project_id, TimeScope::single(exact_key()))
        .await
        .unwrap();

    let exact_text =
        r#"{"kind":"exact","start":"2026-06-20T09:30:00","end":"2026-06-22T14:00:00"}"#.to_string();
    assert_eq!(
        stored_window(&pool, task_id).await,
        (exact_text.clone(), exact_text)
    );
}

#[tokio::test]
async fn a_key_sent_in_any_spelling_is_stored_in_the_one_canonical_text() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    // Fields out of order, with whitespace: the key is re-serialised from its value on the way in.
    let loose: ScopeKey = r#"{ "part": "night", "date": "2026-09-23", "kind": "part_of_day" }"#
        .parse()
        .unwrap();

    let task_id = task_with_window(&pool, project_id, TimeScope::single(loose))
        .await
        .unwrap();

    assert_eq!(
        stored_window(&pool, task_id).await.0,
        r#"{"kind":"part_of_day","date":"2026-09-23","part":"night"}"#
    );
}

#[tokio::test]
async fn text_that_is_not_json_is_refused_by_the_schema() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let written = sqlx::query(
        "INSERT INTO tasks (title, parent_type, parent_id, time_scope_start_id, time_scope_end_id,
                            on_scope_exit)
         VALUES ('Raw', 'project', ?, 'week:2026-09-20', 'week:2026-09-20', 'keep')",
    )
    .bind(project_id)
    .execute(&pool)
    .await;

    assert!(written.is_err(), "a scope column holds JSON or nothing");
}

#[tokio::test]
async fn a_hand_built_key_that_misses_its_start_is_refused_on_write() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let wednesday = ScopeKey::Week {
        date: NaiveDate::from_ymd_opt(2026, 9, 23).unwrap(),
    };

    let written = sqlx::query(
        "INSERT INTO tasks (title, parent_type, parent_id, time_scope_start_id, time_scope_end_id,
                            on_scope_exit)
         VALUES ('Raw', 'project', ?, ?, ?, 'keep')",
    )
    .bind(project_id)
    .bind(wednesday)
    .bind(wednesday)
    .execute(&pool)
    .await;

    assert!(
        written.is_err(),
        "a week keyed by a Wednesday names no scope"
    );
}

#[test]
fn the_scope_commands_derive_without_a_database() {
    let date = "2026-06-20".to_string();

    let week = scope_containing(ScopeKind::Week, date.clone()).unwrap();
    assert_eq!(
        week.id.canonical(),
        r#"{"kind":"week","date":"2026-06-14"}"#
    );
    assert_eq!(week.end_date, "2026-06-20");

    let night = part_scope(date, PartOfDay::Night).unwrap();
    assert_eq!(
        night.id.canonical(),
        r#"{"kind":"part_of_day","date":"2026-06-20","part":"night"}"#
    );
    assert_eq!(night.end_date, "2026-06-21");

    let exact = exact_scope(
        "2026-06-20T09:30:00".to_string(),
        "2026-06-22T14:00:00".to_string(),
    )
    .unwrap();
    assert_eq!(exact.id, exact_key());
}

/// The calendar cell a corpus case names: the kind, and a date inside it (or a band, or two
/// datetimes).
#[derive(serde::Deserialize)]
struct Cell {
    kind: ScopeKind,
    date: Option<NaiveDate>,
    part: Option<PartOfDay>,
    start: Option<NaiveDateTime>,
    end: Option<NaiveDateTime>,
}

/// One case of the shared key corpus, which the frontend's `scope-key` module replays too.
#[derive(serde::Deserialize)]
struct KeyCase {
    cell: Cell,
    key: serde_json::Value,
    text: String,
    window: Window,
}

/// A case's half-open window, which the frontend derives on its own for its filter.
#[derive(serde::Deserialize)]
struct Window {
    start: NaiveDateTime,
    end: NaiveDateTime,
}

#[derive(serde::Deserialize)]
struct KeyCorpus {
    cases: Vec<KeyCase>,
}

const KEY_CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/scope-keys.json"
));

#[test]
fn every_key_in_the_shared_corpus_has_the_same_canonical_text_here() {
    let corpus: KeyCorpus = serde_json::from_str(KEY_CORPUS).unwrap();
    assert!(!corpus.cases.is_empty());
    for case in corpus.cases {
        let cell = case.cell;
        let key = match (cell.kind, cell.date, cell.part, cell.start, cell.end) {
            (ScopeKind::PartOfDay, Some(date), Some(part), _, _) => ScopeKey::part(date, part),
            (ScopeKind::Exact, _, _, Some(start), Some(end)) => {
                ScopeKey::exact(start, end).unwrap()
            }
            (kind, Some(date), None, None, None) => ScopeKey::containing(kind, date).unwrap(),
            _ => panic!("malformed corpus case {}", case.text),
        };
        assert_eq!(key.canonical(), case.text, "the canonical text");
        assert_eq!(
            key.bounds(),
            (case.window.start, case.window.end),
            "the window of {}",
            case.text
        );
        assert_eq!(
            serde_json::to_value(key).unwrap(),
            case.key,
            "the wire object"
        );
        let parsed: ScopeKey = case.text.parse().unwrap();
        assert_eq!(parsed, key, "{} round-trips", case.text);
        assert_eq!(parsed.canonical(), case.text);
    }
}
