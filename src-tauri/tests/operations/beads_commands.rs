//! Integration coverage for `clear_beads_id` (`src/commands/beads.rs`).
//!
//! The one write on the issue-link column that does not come from the MCP server. Everything here
//! reads the column **out of the database** afterwards rather than trusting the command's return:
//! the failure this feature is most exposed to is a clear that returns `Ok` and lands nowhere, and
//! an assertion on the call's own result would pass for exactly that.
//!
//! The pool has **one** connection (see [`helpers::test_pool`]), so every read happens after the
//! command's session has closed.

use crate::helpers;

use arlesh_lib::{
    commands::beads::clear_beads_id,
    domains::model::{CreateDomainRequest, DomainId, DomainSubtype, ProjectStatus},
    scopes::model::ScopeKind,
    tasks::{
        create_commitment, create_goal, create_task,
        model::{
            CommitmentId, CreateCommitmentRequest, CreateGoalRequest, CreateTaskRequest, GoalId,
            TaskId, TimeScope,
        },
    },
};
use chrono::NaiveDate;
use tauri::Manager;

// ===========================================================================
// Fixtures. Each `tests/*` group is its own crate, so these are local rather than shared.
// ===========================================================================

/// The fixed "Growth" aspect's id, the anchor every domain-table fixture hangs off.
async fn growth_aspect_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn make_domain(pool: &sqlx::SqlitePool, subtype: DomainSubtype, title: &str) -> i64 {
    let aspect_id = growth_aspect_id(pool).await;
    let status = match subtype {
        DomainSubtype::Project => Some(ProjectStatus::Active),
        _ => None,
    };
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: title.into(),
            description: None,
            subtype,
            parent_id: Some(aspect_id),
            status,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

/// A one-day window, so a Commitment has something to be held over.
async fn one_day(pool: &sqlx::SqlitePool) -> TimeScope {
    let scope = helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .scopes()
        .get_or_create(ScopeKind::Day, NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();
    TimeScope {
        start_id: scope.id,
        end_id: scope.id,
        duration: None,
    }
}

/// The `beads_id` column as the database holds it, read straight off the table.
async fn stored_beads_id(pool: &sqlx::SqlitePool, table: &str, id: i64) -> Option<String> {
    sqlx::query_scalar(&format!("SELECT beads_id FROM {table} WHERE id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// A Task, a Goal, a Commitment and a Project, each already linked to an issue.
///
/// Returns their ids in that order. Linking goes through the operator setters, which is the path
/// the MCP server takes — the only way one of these links is ever established.
async fn linked_nodes(pool: &sqlx::SqlitePool) -> (i64, i64, i64, i64) {
    let project_id = make_domain(pool, DomainSubtype::Project, "Test Project").await;
    let tonight = one_day(pool).await;

    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Wire the × up".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Issue links are droppable".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let commitment = create_commitment(
        &mut db,
        CreateCommitmentRequest {
            title: "Asleep by 23:00".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(tonight),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.tasks()
        .set_beads_id(TaskId(task.id), Some("Arlesh-ta1".into()))
        .await
        .unwrap();
    db.goals()
        .set_beads_id(GoalId(goal.id), Some("Arlesh-go1".into()))
        .await
        .unwrap();
    db.commitments()
        .set_beads_id(CommitmentId(commitment.id), Some("Arlesh-co1".into()))
        .await
        .unwrap();
    db.domains()
        .set_beads_id(DomainId(project_id), Some("Arlesh-pr1".into()))
        .await
        .unwrap();
    db.commit().await.unwrap();

    (task.id, goal.id, commitment.id, project_id)
}

// ===========================================================================
// The clear itself.
// ===========================================================================

#[tokio::test]
async fn clearing_a_link_writes_null_to_the_column_for_every_kind_that_carries_one() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (task_id, goal_id, commitment_id, project_id) = linked_nodes(&pool).await;

    for (node_type, table, id) in [
        ("task", "tasks", task_id),
        ("goal", "goals", goal_id),
        ("commitment", "commitments", commitment_id),
        ("project", "domains", project_id),
    ] {
        assert!(
            stored_beads_id(&pool, table, id).await.is_some(),
            "{node_type} must start out linked, or the clear proves nothing"
        );
        clear_beads_id(app.state(), node_type.into(), id)
            .await
            .unwrap_or_else(|error| panic!("clearing a {node_type} link failed: {error:?}"));
        assert_eq!(
            stored_beads_id(&pool, table, id).await,
            None,
            "the {node_type}'s column must hold SQL NULL afterwards — an id that survives in the \
             database is the whole failure mode this command exists to avoid"
        );
    }
}

#[tokio::test]
async fn clearing_one_node_leaves_every_other_link_alone() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let (task_id, goal_id, commitment_id, project_id) = linked_nodes(&pool).await;

    clear_beads_id(app.state(), "task".into(), task_id)
        .await
        .unwrap();

    assert_eq!(stored_beads_id(&pool, "tasks", task_id).await, None);
    assert_eq!(
        stored_beads_id(&pool, "goals", goal_id).await,
        Some("Arlesh-go1".into())
    );
    assert_eq!(
        stored_beads_id(&pool, "commitments", commitment_id).await,
        Some("Arlesh-co1".into())
    );
    assert_eq!(
        stored_beads_id(&pool, "domains", project_id).await,
        Some("Arlesh-pr1".into())
    );
}

#[tokio::test]
async fn clearing_a_node_that_carries_no_link_is_not_an_error() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_domain(&pool, DomainSubtype::Project, "Test Project").await;
    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Never linked".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        task
    };

    clear_beads_id(app.state(), "task".into(), task.id)
        .await
        .expect("a second press on a stale editor reads as \"already gone\", not as a failure");
    assert_eq!(stored_beads_id(&pool, "tasks", task.id).await, None);
}

// ===========================================================================
// What it refuses.
// ===========================================================================

#[tokio::test]
async fn clearing_a_domain_that_is_not_a_project_is_refused_and_writes_nothing() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let tag_id = make_domain(&pool, DomainSubtype::Tag, "a-tag").await;
    // Reached past the operator on purpose: the subtype rule has no schema constraint behind it,
    // so the only way to set up the case is to write the column the command is meant to refuse.
    {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        db.domains()
            .set_beads_id(DomainId(tag_id), Some("Arlesh-tag".into()))
            .await
            .unwrap();
        db.commit().await.unwrap();
    }

    let refused = clear_beads_id(app.state(), "project".into(), tag_id)
        .await
        .expect_err("only the project subtype of Domain carries an issue link");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(wire["kind"], "invalid_request");
    assert_eq!(
        stored_beads_id(&pool, "domains", tag_id).await,
        Some("Arlesh-tag".into()),
        "a refusal rolls back rather than half-clearing"
    );
}

#[tokio::test]
async fn clearing_a_kind_that_cannot_carry_a_link_is_refused_by_name() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_domain(&pool, DomainSubtype::Project, "Test Project").await;

    let refused = clear_beads_id(app.state(), "info".into(), project_id)
        .await
        .expect_err("an Info carries no issue link, and silence would hide the typo");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(wire["kind"], "invalid_request");
    assert!(
        wire["message"].as_str().unwrap().contains("info"),
        "the refusal names the kind it was given: {}",
        wire["message"]
    );
}

#[tokio::test]
async fn clearing_an_unknown_node_is_an_error_rather_than_a_silent_no_op() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);

    for node_type in ["task", "goal", "commitment", "project"] {
        let outcome = clear_beads_id(app.state(), node_type.into(), 999_999).await;
        assert!(
            outcome.is_err(),
            "an unknown {node_type} must be an error, not success reported for a write that \
             landed nowhere"
        );
    }
}
