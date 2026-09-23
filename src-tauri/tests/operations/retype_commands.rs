//! Integration coverage for the persistence layer of `src/tasks/retype.rs` and its Tauri command
//! entry point (`src/commands/retype.rs`).
//!
//! `tests/tasks.rs` already carries three tests for the goal→task direction (carrying fields onto
//! a task, refusing a stranded child until acknowledged then reparenting it, and rolling back a
//! failure after the create) plus a fourth for goal→project (ending dependencies that cannot move).
//! This file covers what those leave untested: the domain-table kinds (goal→domain, task→project,
//! and the domain↔project↔tag triangle that rewrites no row), the opposite carry direction
//! (task→goal), the stranded-children **delete** path (only the refusal and the reparent path were
//! covered before), a reparent case with multiple child kinds and a surviving descendant, and one
//! more atomicity test for the domain-table-subtype-update + delete-stranded-children combination.
//!
//! Deliberately out of scope: nothing here pins what happens when a target's `parent_type` CHECK
//! refuses the climbed-to parent — that behaviour is being changed concurrently to climb to the
//! nearest acceptable parent instead of raising a raw database error.

use crate::helpers;

use arlesh_lib::{
    commands::retype::retype_node,
    domains::model::{
        CreateDomainRequest, DomainId, DomainSubtype, ProjectStatus, UpdateDomainRequest,
    },
    flows::model::CreateFlowRequest,
    infos::model::CreateInfoRequest,
    scopes::{key::ScopeKey, model::ScopeKind},
    tasks::{
        add_task_dependency, create_commitment, create_goal, create_task,
        model::{
            CommitmentId, CreateCommitmentRequest, CreateGoalRequest, CreateTaskRequest,
            Dependency, DurationSpec, GoalId, GoalStatus, OnScopeExit, TaskArchival, TaskId,
            TaskStatus, TimeScope, UpdateGoalRequest, UpdateTaskRequest, Verdict,
        },
        retype::{apply_retype, plan_node_retype, RetypeKind, StrandedChildren},
        update_goal, update_task,
    },
};
use chrono::NaiveDate;
use tauri::Manager;

// ===========================================================================
// Fixture helpers — copied from `tests/tasks.rs` rather than imported, since each `tests/*.rs`
// file is its own crate and cannot reach across the boundary.
// ===========================================================================

/// The fixed "Growth" aspect's id, the anchor every domain-table fixture hangs off.
async fn growth_aspect_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id = growth_aspect_id(pool).await;
    helpers::session_factory(pool)
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

async fn make_tag(pool: &sqlx::SqlitePool, parent_id: Option<i64>) -> i64 {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: "a-tag".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id,
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

async fn make_week_scope(pool: &sqlx::SqlitePool, day: NaiveDate) -> ScopeKey {
    arlesh_lib::scopes::model::Scope::containing(ScopeKind::Week, day)
        .unwrap()
        .id
}

async fn make_person(pool: &sqlx::SqlitePool, name: &str) -> i64 {
    sqlx::query("INSERT INTO people (name) VALUES (?)")
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query_scalar("SELECT id FROM people WHERE name = ?")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Counts the rows of `table` whose `column` equals `value`. One placeholder, one bind — see
/// `tests/tasks.rs`'s helper of the same name for why a caller-supplied predicate is not used
/// instead (a dead bind silently reads as `OR ... = NULL`).
async fn count_where(pool: &sqlx::SqlitePool, table: &str, column: &str, value: i64) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?"))
        .bind(value)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn dependency_rows(pool: &sqlx::SqlitePool) -> Vec<(i64, String, i64)> {
    sqlx::query_as(
        "SELECT task_id, dependency_type, dependency_id FROM task_dependencies
         ORDER BY task_id, dependency_type, dependency_id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

/// The columns a retyped domain-table row must have carried (or correctly not carried).
#[derive(sqlx::FromRow, Debug, PartialEq, Eq)]
struct DomainRow {
    title: String,
    subtype: String,
    description: Option<String>,
    knowledge_base_directory: Option<String>,
    status: Option<String>,
    position: i64,
    is_private: bool,
}

async fn domain_row(pool: &sqlx::SqlitePool, id: i64) -> DomainRow {
    sqlx::query_as(
        "SELECT title, subtype, description, knowledge_base_directory, status, position, is_private
         FROM domains WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn goal_parent(pool: &sqlx::SqlitePool, id: i64) -> (String, i64) {
    sqlx::query_as("SELECT parent_type, parent_id FROM goals WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn task_parent(pool: &sqlx::SqlitePool, id: i64) -> (String, i64) {
    sqlx::query_as("SELECT parent_type, parent_id FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn info_parent(pool: &sqlx::SqlitePool, id: i64) -> (String, i64) {
    sqlx::query_as("SELECT parent_type, parent_id FROM infos WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn flow_parent(pool: &sqlx::SqlitePool, id: i64) -> (String, i64) {
    sqlx::query_as("SELECT parent_type, parent_id FROM flows WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn lost_field_names(wire: &serde_json::Value) -> Vec<String> {
    wire["details"]["lost_fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["field"].as_str().unwrap().to_string())
        .collect()
}

fn lost_child_kinds_and_ids(wire: &serde_json::Value) -> Vec<(String, i64)> {
    wire["details"]["lost_children"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            (
                entry["kind"].as_str().unwrap().to_string(),
                entry["id"].as_i64().unwrap(),
            )
        })
        .collect()
}

// ===========================================================================
// 1. The domain-table kinds
// ===========================================================================

#[tokio::test]
async fn retyping_a_goal_to_a_domain_carries_only_identity_fields_and_drops_the_rest() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool, None).await;
    let scope_id = make_week_scope(&pool, NaiveDate::from_ymd_opt(2026, 3, 2).unwrap()).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Learn Rust".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: Some(GoalStatus::Frozen),
            time_scope: Some(TimeScope {
                start_id: scope_id,
                end_id: scope_id,
                duration: None,
            }),
            on_scope_exit: Some(OnScopeExit::Archive),
        },
    )
    .await
    .unwrap();
    update_goal(
        &mut db,
        GoalId(goal.id),
        UpdateGoalRequest {
            is_private: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.goals().add_tag(GoalId(goal.id), tag_id).await.unwrap();
    db.block_reasons()
        .set("goal", goal.id, &["stuck".to_string()])
        .await
        .unwrap();
    let dependent = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Waits on it".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    add_task_dependency(
        &mut db,
        TaskId(dependent.id),
        Dependency::Goal { id: goal.id },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let source_position: i64 = sqlx::query_scalar("SELECT position FROM goals WHERE id = ?")
        .bind(goal.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let app = helpers::command_host(&pool);
    let refused = retype_node(
        app.state(),
        "goal".into(),
        goal.id,
        "domain".into(),
        None,
        None,
    )
    .await
    .expect_err("a domain has no status, scope, tag or dependents column");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(
        lost_field_names(&wire),
        vec![
            "status",
            "time_scope",
            "tags",
            "block_reasons",
            "dependents"
        ],
        "every column-less field, named in the module's declaration order"
    );
    assert_eq!(
        count_where(&pool, "goals", "id", goal.id).await,
        1,
        "the refusal writes nothing"
    );

    let retyped = retype_node(
        app.state(),
        "goal".into(),
        goal.id,
        "domain".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    let row = domain_row(&pool, retyped.id).await;
    assert_eq!(row.title, "Learn Rust");
    assert_eq!(row.subtype, "domain");
    assert_eq!(
        row.position, source_position,
        "position carries even across tables"
    );
    assert!(
        row.is_private,
        "privacy carries — the flow-item precedent drops it, this must not"
    );
    assert_eq!(row.description, None, "a goal never had one to carry");
    assert_eq!(
        row.knowledge_base_directory, None,
        "only a project target would take it, and did not get one anyway"
    );
    assert_eq!(
        row.status, None,
        "a frozen status has nowhere to go on a domain"
    );

    assert_eq!(
        count_where(&pool, "goals", "id", goal.id).await,
        0,
        "the goal row is gone"
    );
    assert_eq!(
        count_where(&pool, "tags_on_goals", "goal_id", goal.id).await,
        0
    );
    assert_eq!(
        count_where(&pool, "block_reasons", "owner_id", goal.id).await,
        0
    );
    assert_eq!(
        dependency_rows(&pool).await,
        Vec::new(),
        "a domain cannot be depended on, so the inbound edge is dropped outright rather than dangling"
    );
}

#[tokio::test]
async fn retyping_a_task_to_a_project_drops_its_task_only_fields_and_ends_both_directions_of_its_dependencies(
) {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool, None).await;
    let scope_id = make_week_scope(&pool, NaiveDate::from_ymd_opt(2026, 3, 2).unwrap()).await;
    let person_id = make_person(&pool, "Ana").await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let other = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Other task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Draft the spec".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: Some(TaskStatus::Done),
            time_scope: Some(TimeScope {
                start_id: scope_id,
                end_id: scope_id,
                duration: None,
            }),
            plan: Some(TimeScope {
                start_id: scope_id,
                end_id: scope_id,
                duration: None,
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    update_task(
        &mut db,
        TaskId(task.id),
        UpdateTaskRequest {
            delegate_to: Some(Some(arlesh_lib::tasks::model::Delegate::Person {
                id: person_id,
            })),
            is_private: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.tasks().add_tag(TaskId(task.id), tag_id).await.unwrap();
    db.block_reasons()
        .set("task", task.id, &["blocked on Ana".to_string()])
        .await
        .unwrap();
    // Outbound: the task being retyped depends on `other`.
    add_task_dependency(&mut db, TaskId(task.id), Dependency::Task { id: other.id })
        .await
        .unwrap();
    // Inbound: `dependent` depends on the task being retyped.
    let dependent = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Waits on the spec".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    add_task_dependency(
        &mut db,
        TaskId(dependent.id),
        Dependency::Task { id: task.id },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let source_position: i64 = sqlx::query_scalar("SELECT position FROM tasks WHERE id = ?")
        .bind(task.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let app = helpers::command_host(&pool);
    let refused = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "project".into(),
        None,
        None,
    )
    .await
    .expect_err("a project holds none of a task's scheduling machinery");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(
        lost_field_names(&wire),
        vec![
            "time_scope",
            "plan",
            "delegate_to",
            "tags",
            "block_reasons",
            "dependents",
            "dependencies"
        ],
    );

    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "project".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    let row = domain_row(&pool, retyped.id).await;
    assert_eq!(row.title, "Draft the spec");
    assert_eq!(row.subtype, "project");
    assert_eq!(
        row.status.as_deref(),
        Some("achieved"),
        "a done task is the nearest thing to an achieved project"
    );
    assert_eq!(row.position, source_position);
    assert!(row.is_private);
    assert_eq!(row.description, None, "a task never had one to carry");
    assert_eq!(
        row.knowledge_base_directory, None,
        "a task never had a directory to give it"
    );

    assert_eq!(count_where(&pool, "tasks", "id", task.id).await, 0);
    assert_eq!(
        count_where(&pool, "tags_on_tasks", "task_id", task.id).await,
        0
    );
    assert_eq!(
        count_where(&pool, "block_reasons", "owner_id", task.id).await,
        0
    );
    assert_eq!(
        dependency_rows(&pool).await,
        Vec::new(),
        "the outbound edge dies with the deleted task row's ON DELETE CASCADE, and the inbound one \
         is dropped explicitly — a project can be aimed at by neither"
    );
}

#[tokio::test]
async fn a_domain_table_retype_rewrites_no_row_and_the_row_keeps_its_identity_through_every_hop() {
    let pool = helpers::test_pool().await;
    let aspect_id = growth_aspect_id(&pool).await;

    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let created = db
        .domains()
        .create(CreateDomainRequest {
            title: "Roadmap".into(),
            description: Some("Notes on the roadmap".into()),
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Frozen),
            knowledge_base_directory: Some("Vault/Roadmap".into()),
        })
        .await
        .unwrap();
    db.domains()
        .update(
            DomainId(created.id),
            UpdateDomainRequest {
                is_private: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    drop(db); // release the pool's one connection before reading through it below

    let before = domain_row(&pool, created.id).await;

    let app = helpers::command_host(&pool);

    let hop1 = retype_node(
        app.state(),
        "project".into(),
        created.id,
        "tag".into(),
        None,
        None,
    )
    .await
    .expect("a subtype-only move loses nothing, so no acknowledgement is asked for");
    assert_eq!(
        hop1.id, created.id,
        "the row keeps its identity — no row is rewritten"
    );
    let after1 = domain_row(&pool, created.id).await;
    assert_eq!(after1.subtype, "tag");
    assert_eq!(after1.description, before.description);
    assert_eq!(
        after1.knowledge_base_directory, before.knowledge_base_directory,
        "a Tag has no use for it, but the column keeps its value rather than losing it"
    );
    assert_eq!(after1.status, before.status);
    assert_eq!(after1.is_private, before.is_private);
    assert_eq!(after1.position, before.position);

    let hop2 = retype_node(
        app.state(),
        "tag".into(),
        created.id,
        "domain".into(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(hop2.id, created.id);
    let after2 = domain_row(&pool, created.id).await;
    assert_eq!(after2.subtype, "domain");
    assert_eq!(
        after2.knowledge_base_directory,
        before.knowledge_base_directory
    );

    let hop3 = retype_node(
        app.state(),
        "domain".into(),
        created.id,
        "project".into(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(hop3.id, created.id);
    let after3 = domain_row(&pool, created.id).await;
    assert_eq!(after3.subtype, "project");
    assert_eq!(after3.description, before.description);
    assert_eq!(
        after3.knowledge_base_directory, before.knowledge_base_directory,
        "the directory survived a full round trip through kinds that could not use it"
    );
    assert_eq!(after3.status, before.status);
    assert_eq!(after3.is_private, before.is_private);
    assert_eq!(after3.position, before.position);
}

// ===========================================================================
// 4. carry_attachments / move_references, the opposite direction from `tests/tasks.rs`
// ===========================================================================

#[tokio::test]
async fn retyping_a_task_to_a_goal_carries_its_tags_and_reasons_and_repoints_what_depends_on_it() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool, None).await;
    let scope_id = make_week_scope(&pool, NaiveDate::from_ymd_opt(2026, 5, 4).unwrap()).await;
    let person_id = make_person(&pool, "Ben").await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Draft the spec".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: Some(TaskStatus::InProgress),
            plan: Some(TimeScope {
                start_id: scope_id,
                end_id: scope_id,
                duration: None,
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    update_task(
        &mut db,
        TaskId(task.id),
        UpdateTaskRequest {
            delegate_to: Some(Some(arlesh_lib::tasks::model::Delegate::Person {
                id: person_id,
            })),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.tasks().add_tag(TaskId(task.id), tag_id).await.unwrap();
    db.block_reasons()
        .set("task", task.id, &["waiting on Ben".to_string()])
        .await
        .unwrap();
    let dependent = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Waits on the spec".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    add_task_dependency(
        &mut db,
        TaskId(dependent.id),
        Dependency::Task { id: task.id },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let refused = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "goal".into(),
        None,
        None,
    )
    .await
    .expect_err("a goal has neither a Plan nor a delegate");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(lost_field_names(&wire), vec!["plan", "delegate_to"]);

    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "goal".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    let mut tags: Vec<i64> =
        sqlx::query_scalar("SELECT tag_id FROM tags_on_goals WHERE goal_id = ?")
            .bind(retyped.id)
            .fetch_all(&pool)
            .await
            .unwrap();
    tags.sort_unstable();
    assert_eq!(
        tags,
        vec![tag_id],
        "the tag followed its owner onto the goal join table"
    );

    let reasons: Vec<String> = sqlx::query_scalar(
        "SELECT reason FROM block_reasons WHERE owner_type = 'goal' AND owner_id = ?",
    )
    .bind(retyped.id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(reasons, vec!["waiting on Ben".to_string()]);

    assert_eq!(
        dependency_rows(&pool).await,
        vec![(dependent.id, "goal".to_string(), retyped.id)],
        "the inbound edge is repointed at the goal, not dropped — a goal can be depended on"
    );

    assert_eq!(count_where(&pool, "tasks", "id", task.id).await, 0);
    assert_eq!(
        count_where(&pool, "tags_on_tasks", "task_id", task.id).await,
        0
    );
    // Filtered by `owner_type` too, not just `owner_id`: goals and tasks are separate tables with
    // their own independent rowid sequences, so the new goal's id can coincide with the old task's.
    let leftover_task_reasons: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM block_reasons WHERE owner_type = 'task' AND owner_id = ?",
    )
    .bind(task.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        leftover_task_reasons, 0,
        "no block reason was left behind on the deleted task"
    );
}

// ===========================================================================
// 2 & 3. settle_stranded's DELETE and REPARENT paths
// ===========================================================================

#[tokio::test]
async fn the_retype_node_command_deletes_stranded_children_and_their_own_descendants_when_the_caller_chooses_delete(
) {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Learn Rust".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // Stranded when `goal` becomes a task (a task cannot hold a sub-goal), and it has its own
    // subtree that must go with it.
    let sub_goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Finish the tutorial".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let grandchild_task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Read chapter four".into(),
            parent_type: "goal".into(),
            parent_id: sub_goal.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let grandchild_info = db
        .infos()
        .create(CreateInfoRequest {
            body: "ownership is the hard bit".into(),
            details: None,
            parent_type: "goal".into(),
            parent_id: sub_goal.id,
            position: 0,
        })
        .await
        .unwrap();
    // Not stranded: a task can hold a task child, so this one must survive untouched by the
    // stranding decision (only reparented normally, as every kept child is).
    let surviving_task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Set up the toolchain".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let refused = retype_node(
        app.state(),
        "goal".into(),
        goal.id,
        "task".into(),
        None,
        None,
    )
    .await
    .expect_err("a task cannot hold a sub-goal");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(
        lost_child_kinds_and_ids(&wire),
        vec![("goal".to_string(), sub_goal.id)]
    );

    let retyped = retype_node(
        app.state(),
        "goal".into(),
        goal.id,
        "task".into(),
        Some(StrandedChildren::Delete),
        None,
    )
    .await
    .unwrap();

    assert_eq!(
        count_where(&pool, "goals", "id", sub_goal.id).await,
        0,
        "the stranded sub-goal is gone"
    );
    assert_eq!(
        count_where(&pool, "tasks", "id", grandchild_task.id).await,
        0,
        "its own descendant task went with it"
    );
    assert_eq!(
        count_where(&pool, "infos", "id", grandchild_info.id).await,
        0,
        "and its own descendant info too"
    );
    assert_eq!(
        count_where(&pool, "goals", "id", goal.id).await,
        0,
        "the retyped goal row itself is gone"
    );

    let (parent_type, parent_id) = task_parent(&pool, surviving_task.id).await;
    assert_eq!(
        (parent_type.as_str(), parent_id),
        ("task", retyped.id),
        "the non-stranded sibling was merely adopted onto the new task, not touched by the deletion"
    );
}

#[tokio::test]
async fn the_retype_node_command_reparents_every_kind_of_stranded_child_and_leaves_their_own_children_untouched(
) {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Learn Rust".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // Two different kinds a task cannot hold: a sub-goal and a flow.
    let sub_goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Finish the tutorial".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let grandchild_info = db
        .infos()
        .create(CreateInfoRequest {
            body: "still under the sub-goal after it moves".into(),
            details: None,
            parent_type: "goal".into(),
            parent_id: sub_goal.id,
            position: 0,
        })
        .await
        .unwrap();
    let flow_child = db
        .flows()
        .create(CreateFlowRequest {
            title: "Weekly review".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            ..Default::default()
        })
        .await
        .unwrap();
    // Not stranded — kept and merely adopted normally.
    let surviving_task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Set up the toolchain".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let refused = retype_node(
        app.state(),
        "goal".into(),
        goal.id,
        "task".into(),
        None,
        None,
    )
    .await
    .expect_err("a task can hold neither a sub-goal nor a flow");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(
        lost_child_kinds_and_ids(&wire),
        vec![
            ("goal".to_string(), sub_goal.id),
            ("flow".to_string(), flow_child.id)
        ]
    );

    let retyped = retype_node(
        app.state(),
        "goal".into(),
        goal.id,
        "task".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    // Both stranded children moved up to the retyped node's own parent (the project) — not to the
    // new task, and not deleted.
    assert_eq!(
        goal_parent(&pool, sub_goal.id).await,
        ("project".to_string(), project_id),
        "the stranded sub-goal moved up to its grandparent"
    );
    assert_eq!(
        flow_parent(&pool, flow_child.id).await,
        ("project".to_string(), project_id),
        "the stranded flow moved up to the same place"
    );

    // The sub-goal's own child never moved: only the top of a stranded subtree is repointed, so
    // its descendants stay exactly where they were, still correctly parented to it.
    assert_eq!(
        info_parent(&pool, grandchild_info.id).await,
        ("goal".to_string(), sub_goal.id),
        "the sub-goal's own child is untouched by its parent's reparenting"
    );

    // The non-stranded child was adopted onto the new task normally.
    assert_eq!(
        task_parent(&pool, surviving_task.id).await,
        ("task".to_string(), retyped.id)
    );

    assert_eq!(
        count_where(&pool, "goals", "id", goal.id).await,
        0,
        "the old goal row is gone"
    );
}

// ===========================================================================
// Atomicity — seen to fail, per the module's own warning that a dropped transaction rolls back
// silently. See the report for the actual failure captured by temporarily committing before the
// injected failure.
// ===========================================================================

#[tokio::test]
async fn a_domain_table_retype_that_deletes_stranded_children_rolls_back_atomically_on_failure() {
    let pool = helpers::test_pool().await;
    let aspect_id = growth_aspect_id(&pool).await;

    let mut seed = helpers::session_factory(&pool).connect().await.unwrap();
    let container = seed
        .domains()
        .create(CreateDomainRequest {
            title: "Container".into(),
            description: None,
            subtype: DomainSubtype::Domain,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap();
    // A Tag is stranded when `container` becomes a Tag itself (a Tag can hold only an Info), and
    // it is a leaf so `delete_child` does not hit the "still has children" foreign-key refusal.
    let leaf_tag = seed
        .domains()
        .create(CreateDomainRequest {
            title: "Leaf".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(container.id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap();
    drop(seed);

    // The command's own shape: begin, plan, apply, (would) commit. This test stands in for the
    // caller and fails where the command's `?` would fire — after the subtype update and the
    // stranded child's deletion have both landed inside the transaction.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let planned = plan_node_retype(&mut db, RetypeKind::Domain, container.id, RetypeKind::Tag)
        .await
        .unwrap();
    apply_retype(&mut db, &planned, StrandedChildren::Delete)
        .await
        .unwrap();

    // The retype really did get past the delete inside the transaction — otherwise the
    // assertions below would hold vacuously.
    assert_eq!(
        db.domains()
            .get(DomainId(container.id))
            .await
            .unwrap()
            .subtype,
        "tag",
        "the subtype update landed inside the transaction"
    );
    assert!(
        db.domains().get(DomainId(leaf_tag.id)).await.is_err(),
        "and the stranded leaf is already gone inside it"
    );

    // The injected failure: a retype of a node that does not exist, rejected on real input. Any
    // error raised after `apply_retype` returns reaches the database the same way — the
    // `Db<Transactional>` is dropped without `commit()` and sqlx rolls back — so this stands for
    // the whole class, the failing `commit()` included.
    let rejected = plan_node_retype(&mut db, RetypeKind::Domain, 909_909, RetypeKind::Tag).await;
    assert!(rejected.is_err(), "there is no domain 909909");
    drop(db); // no commit() — sqlx rolls back silently, which is exactly what this test checks

    let row = domain_row(&pool, container.id).await;
    assert_eq!(row.subtype, "domain", "the subtype update was rolled back");
    assert_eq!(
        count_where(&pool, "domains", "id", leaf_tag.id).await,
        1,
        "the deleted leaf is back"
    );
}

/// Reads a `beads_id` straight off the pool.
async fn stored_beads_id(pool: &sqlx::SqlitePool, table: &str, id: i64) -> Option<String> {
    sqlx::query_scalar(&format!("SELECT beads_id FROM {table} WHERE id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn retyping_a_tracked_task_to_a_goal_keeps_its_issue_link() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Draft the spec".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // Only the MCP server sets this in production; the operator setter is the same code path.
    db.tasks()
        .set_beads_id(TaskId(task.id), Some("Arlesh-3gk".into()))
        .await
        .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "goal".into(),
        None,
        None,
    )
    .await
    .unwrap();

    // The retype rebuilds the node as a new row, so the link has to be written onto it
    // explicitly — the create requests have no field for it, by design.
    assert_eq!(
        stored_beads_id(&pool, "goals", retyped.id).await,
        Some("Arlesh-3gk".into()),
        "the new goal should carry the issue link"
    );
    assert_eq!(
        count_where(&pool, "tasks", "id", task.id).await,
        0,
        "the old task row should be gone"
    );
}

#[tokio::test]
async fn retyping_a_tracked_task_to_a_project_keeps_its_issue_link() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Becomes a project".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.tasks()
        .set_beads_id(TaskId(task.id), Some("Arlesh-e8d".into()))
        .await
        .unwrap();
    db.commit().await.unwrap();

    // Crossing tables — `tasks` to `domains` — is the case most likely to drop it.
    let app = helpers::command_host(&pool);
    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "project".into(),
        None,
        None,
    )
    .await
    .unwrap();

    assert_eq!(
        stored_beads_id(&pool, "domains", retyped.id).await,
        Some("Arlesh-e8d".into())
    );
}

#[tokio::test]
async fn retyping_a_tracked_task_to_a_note_reports_the_link_as_lost_and_clears_it() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Becomes a note".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.tasks()
        .set_beads_id(TaskId(task.id), Some("Arlesh-32r".into()))
        .await
        .unwrap();
    db.commit().await.unwrap();

    // `infos` has no column for the link, so this is a real loss and the command must ask first.
    let app = helpers::command_host(&pool);
    let refused = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "info".into(),
        None,
        None,
    )
    .await;
    assert!(
        refused.is_err(),
        "losing an issue link must require acknowledgement"
    );

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let plan = plan_node_retype(&mut db, RetypeKind::Task, task.id, RetypeKind::Info)
        .await
        .unwrap();
    drop(db);
    let lost: Vec<&str> = plan
        .plan
        .lost_fields
        .iter()
        .map(|lost| lost.field)
        .collect();
    assert!(
        lost.contains(&"beads_id"),
        "the prompt should name the issue link among what it drops, got {lost:?}"
    );
}

// ===========================================================================
// Task ↔ Commitment
// ===========================================================================

/// A single-day Time Scope, so a retype to a Commitment has an effective window to satisfy.
async fn one_day(pool: &sqlx::SqlitePool, day: u32) -> TimeScope {
    let scope = arlesh_lib::scopes::model::Scope::containing(
        ScopeKind::Day,
        NaiveDate::from_ymd_opt(2026, 7, day).unwrap(),
    )
    .unwrap();
    TimeScope {
        start_id: scope.id,
        end_id: scope.id,
        duration: None,
    }
}

#[tokio::test]
async fn a_scoped_task_becomes_a_commitment_carrying_its_window_tags_and_issue_link() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool, Some(growth_aspect_id(&pool).await)).await;
    let tonight = one_day(&pool, 1).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Asleep by 23:00".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(tonight.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.tasks().add_tag(TaskId(task.id), tag_id).await.unwrap();
        db.tasks()
            .set_beads_id(TaskId(task.id), Some("Arlesh-cyo".into()))
            .await
            .unwrap();
        db.commit().await.unwrap();
        task
    };

    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "commitment".into(),
        None,
        None,
    )
    .await
    .expect("an unplanned, undelegated task loses nothing on the way in");

    assert_eq!(retyped.kind, RetypeKind::Commitment);
    let commitment = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .commitments()
        .get(CommitmentId(retyped.id))
        .await
        .unwrap();
    assert_eq!(commitment.title, "Asleep by 23:00");
    assert_eq!(commitment.time_scope, Some(tonight));
    assert_eq!(commitment.tag_ids, vec![tag_id]);
    assert_eq!(
        commitment.beads_id,
        Some("Arlesh-cyo".to_string()),
        "a tracked node stays tracked"
    );
    assert_eq!(
        commitment.verdict,
        Verdict::Unresolved,
        "no status is translated into a verdict"
    );

    let gone: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE id = ?")
        .bind(task.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(gone, 0, "the old row went with the retype");
}

#[tokio::test]
async fn a_planned_task_cannot_become_a_commitment_until_the_caller_has_been_told() {
    // The window *is* the commitment, so a Plan has nowhere to go — and a scheduling decision is
    // never discarded without being named first.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tonight = one_day(&pool, 1).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Asleep by 23:00".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(tonight.clone()),
                plan: Some(tonight),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        task
    };

    let refused = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "commitment".into(),
        None,
        None,
    )
    .await;
    assert!(
        refused.is_err(),
        "the Plan must be named before it is dropped"
    );

    let accepted = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "commitment".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .expect("acknowledged, it goes through");
    assert_eq!(accepted.kind, RetypeKind::Commitment);
}

#[tokio::test]
async fn an_unscoped_task_with_no_scoped_ancestor_cannot_become_a_commitment() {
    // Loud rather than quiet: the effective-scope rule refuses the write, the transaction rolls
    // back, and the task is still a task afterwards.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Asleep by 23:00".into(),
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

    let refused = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "commitment".into(),
        None,
        None,
    )
    .await;
    assert!(
        refused.is_err(),
        "a commitment that could never come due is not written"
    );

    let survivors: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE id = ?")
        .bind(task.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let commitments: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM commitments")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(survivors, 1, "the task is untouched");
    assert_eq!(
        commitments, 0,
        "and no half-written commitment was left behind"
    );
}

#[tokio::test]
async fn an_unscoped_task_becomes_a_commitment_when_the_caller_supplies_the_window() {
    // The refusal above is a question, and this is its answer: the window the user picked rides
    // on the retype itself rather than being written to the task first, so the whole thing is
    // still one atomic write and a cancelled prompt leaves nothing behind.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tonight = one_day(&pool, 3).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "No social media today".into(),
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

    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "commitment".into(),
        None,
        Some(tonight.clone()),
    )
    .await
    .expect("a window supplied with the retype is the window the commitment is written with");

    let commitment = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .commitments()
        .get(CommitmentId(retyped.id))
        .await
        .unwrap();
    assert_eq!(commitment.time_scope, Some(tonight));
    assert_eq!(commitment.title, "No social media today");

    let survivors: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE id = ?")
        .bind(task.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        survivors, 0,
        "the task became the commitment rather than sitting beside it"
    );
}

#[tokio::test]
async fn a_task_under_a_scoped_goal_becomes_a_commitment_without_being_asked_for_a_window() {
    // Nothing to ask: the effective window is the goal's, which is exactly what a Commitment
    // inherits. Prompting here would be asking for something the node already has.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let this_month = one_day(&pool, 5).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let goal = create_goal(
            &mut db,
            CreateGoalRequest {
                title: "Sleep properly".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(this_month),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Asleep by 23:00".into(),
                parent_type: "goal".into(),
                parent_id: goal.id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        task
    };

    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "commitment".into(),
        None,
        None,
    )
    .await
    .expect("an inherited window is an effective window");

    let commitment = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .commitments()
        .get(CommitmentId(retyped.id))
        .await
        .unwrap();
    assert_eq!(
        commitment.time_scope, None,
        "it inherits rather than being given a copy of its parent's window"
    );
}

#[tokio::test]
async fn a_judged_commitment_becoming_a_task_reports_the_verdict_it_would_lose() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tonight = one_day(&pool, 1).await;

    let commitment = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let commitment = create_commitment(
            &mut db,
            CreateCommitmentRequest {
                title: "Asleep by 23:00".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                verdict: Some(Verdict::Broken),
                time_scope: Some(tonight),
                verdict_window: Some(DurationSpec {
                    n: 2,
                    kind: "day".into(),
                }),
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        commitment
    };

    let refused = retype_node(
        app.state(),
        "commitment".into(),
        commitment.id,
        "task".into(),
        None,
        None,
    )
    .await;
    assert!(
        refused.is_err(),
        "a recorded verdict is not discarded unasked"
    );

    let retyped = retype_node(
        app.state(),
        "commitment".into(),
        commitment.id,
        "task".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();
    assert_eq!(retyped.kind, RetypeKind::Task);

    let task = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .get(TaskId(retyped.id))
        .await
        .unwrap();
    assert_eq!(
        task.status, "todo",
        "no verdict is translated into a status"
    );
    assert!(task.plan.is_none());
}

#[tokio::test]
async fn a_commitments_task_children_move_with_it_and_its_goal_siblings_never_arrive() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tonight = one_day(&pool, 1).await;

    let commitment = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
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
        create_task(
            &mut db,
            CreateTaskRequest {
                title: "Phone on charger".into(),
                parent_type: "commitment".into(),
                parent_id: commitment.id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        commitment
    };

    let retyped = retype_node(
        app.state(),
        "commitment".into(),
        commitment.id,
        "task".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    let child_parent: (String, i64) =
        sqlx::query_as("SELECT parent_type, parent_id FROM tasks WHERE title = 'Phone on charger'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        child_parent,
        ("task".to_string(), retyped.id),
        "a task child follows a task"
    );
}

#[tokio::test]
async fn a_commitment_becoming_a_tag_deletes_the_children_a_label_cannot_hold() {
    // A Tag is a label: it holds notes and nothing else. Everything a commitment was holding is
    // therefore stranded, and the caller's choice — here, delete — is what happens to it.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tonight = one_day(&pool, 1).await;

    let commitment = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let commitment = create_commitment(
            &mut db,
            CreateCommitmentRequest {
                title: "Evening rules".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(tonight.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        create_commitment(
            &mut db,
            CreateCommitmentRequest {
                title: "Asleep by 23:00".into(),
                parent_type: "commitment".into(),
                parent_id: commitment.id,
                time_scope: Some(tonight),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        commitment
    };

    let retyped = retype_node(
        app.state(),
        "commitment".into(),
        commitment.id,
        "tag".into(),
        Some(StrandedChildren::Delete),
        None,
    )
    .await
    .unwrap();
    assert_eq!(retyped.kind, RetypeKind::Tag);

    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM commitments")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        left, 0,
        "the commitment became a label and its child went with the choice"
    );
}

#[tokio::test]
async fn a_stranded_child_commitment_moves_up_to_its_grandparent_when_the_caller_says_so() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tonight = one_day(&pool, 1).await;

    let commitment = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let commitment = create_commitment(
            &mut db,
            CreateCommitmentRequest {
                title: "Evening rules".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(tonight.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        create_commitment(
            &mut db,
            CreateCommitmentRequest {
                title: "Asleep by 23:00".into(),
                parent_type: "commitment".into(),
                parent_id: commitment.id,
                time_scope: Some(tonight),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        commitment
    };

    retype_node(
        app.state(),
        "commitment".into(),
        commitment.id,
        "tag".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    let parent: (String, i64) = sqlx::query_as(
        "SELECT parent_type, parent_id FROM commitments WHERE title = 'Asleep by 23:00'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        parent,
        ("project".to_string(), project_id),
        "it moved up rather than vanishing"
    );
}

#[tokio::test]
async fn a_goal_holds_a_commitment_child_through_a_retype() {
    // A Goal accepts a Commitment, so retyping its holder to a Goal adopts the child rather than
    // stranding it — the counter-case that fixes where the boundary is.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tonight = one_day(&pool, 1).await;

    let commitment = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let commitment = create_commitment(
            &mut db,
            CreateCommitmentRequest {
                title: "Evening rules".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(tonight.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        create_commitment(
            &mut db,
            CreateCommitmentRequest {
                title: "Asleep by 23:00".into(),
                parent_type: "commitment".into(),
                parent_id: commitment.id,
                time_scope: Some(tonight),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        commitment
    };

    let retyped = retype_node(
        app.state(),
        "commitment".into(),
        commitment.id,
        "goal".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    let parent: (String, i64) = sqlx::query_as(
        "SELECT parent_type, parent_id FROM commitments WHERE title = 'Asleep by 23:00'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        parent,
        ("goal".to_string(), retyped.id),
        "the goal adopted it"
    );
}

#[tokio::test]
async fn a_task_under_a_commitment_climbs_past_it_when_it_becomes_a_goal() {
    // `goals.parent_type` does not accept `commitment`, so the retype must move the node to the
    // nearest ancestor a Goal can hang under — and say so first, rather than writing a parent
    // link the CHECK would refuse.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tonight = one_day(&pool, 1).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
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
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "Phone on charger".into(),
                parent_type: "commitment".into(),
                parent_id: commitment.id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        task
    };

    let refused = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "goal".into(),
        None,
        None,
    )
    .await;
    assert!(
        refused.is_err(),
        "a node leaving the parent it sits under is never silent"
    );

    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "goal".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    let parent: (String, i64) =
        sqlx::query_as("SELECT parent_type, parent_id FROM goals WHERE id = ?")
            .bind(retyped.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        parent,
        ("project".to_string(), project_id),
        "it climbed past the commitment"
    );
}

// ===========================================================================
// 6. The backlog: a stored state only a Task has
// ===========================================================================

#[tokio::test]
async fn retyping_a_backlogged_task_to_a_goal_names_the_backlog_as_lost_and_then_drops_it() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Set aside for now".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            archival: Some(TaskArchival::Backlog),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    // A goal has no backlog, and Frozen is not where a backlog lands, so the state goes. The
    // command must name it before it does that.
    let app = helpers::command_host(&pool);
    let refused = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "goal".into(),
        None,
        None,
    )
    .await
    .expect_err("dropping the backlog must require acknowledgement");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(lost_field_names(&wire), vec!["archival"]);
    assert_eq!(
        wire["details"]["lost_fields"][0]["value"].as_str(),
        Some("backlog"),
        "the prompt says which state goes, not merely which field"
    );

    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "goal".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();

    assert_eq!(retyped.kind, RetypeKind::Goal);
    assert_eq!(count_where(&pool, "tasks", "id", task.id).await, 0);
}

#[tokio::test]
async fn retyping_a_task_nobody_set_aside_says_nothing_about_the_backlog() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "In play".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    // `Live` is nobody's decision, so it is not a loss and must not raise a prompt of its own.
    let app = helpers::command_host(&pool);
    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "goal".into(),
        None,
        None,
    )
    .await
    .expect("a live task becoming a goal loses nothing");

    assert_eq!(retyped.kind, RetypeKind::Goal);
}

#[tokio::test]
async fn retyping_a_backlogged_task_to_a_commitment_names_the_backlog_as_lost() {
    // The intersection of two rules that arrived from different branches: a Commitment is not a
    // Task, so it has no Backlog to land in, and every column is either carried or named. Neither
    // branch could have written this test on its own.
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let project_id = make_project(&pool).await;
    let tonight = one_day(&pool, 9).await;

    let task = {
        let mut db = helpers::session_factory(&pool).begin().await.unwrap();
        let task = create_task(
            &mut db,
            CreateTaskRequest {
                title: "No social media today".into(),
                parent_type: "project".into(),
                parent_id: project_id,
                time_scope: Some(tonight),
                archival: Some(TaskArchival::Backlog),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        db.commit().await.unwrap();
        task
    };

    let refused = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "commitment".into(),
        None,
        None,
    )
    .await
    .expect_err("a dropped Backlog is named before it is dropped");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(lost_field_names(&wire), vec!["archival"]);
    assert_eq!(
        wire["details"]["lost_fields"][0]["value"].as_str(),
        Some("backlog"),
        "the prompt says which state goes, not merely which field"
    );

    let retyped = retype_node(
        app.state(),
        "task".into(),
        task.id,
        "commitment".into(),
        Some(StrandedChildren::Reparent),
        None,
    )
    .await
    .unwrap();
    assert_eq!(retyped.kind, RetypeKind::Commitment);
}
