//! Integration coverage for `src/duplicate/mod.rs` and its four Tauri command entry points.
//!
//! The Mindmap's Copy and Cut were the same gesture until this module existed — paste always
//! reparented the original. These tests state what the tree looks like *after* a paste: where the
//! original is, what the copy contains, and what each copied node carries. None of them counts
//! inserts.
//!
//! Everything goes through the commands rather than through `duplicate_subtree` directly, with
//! one exception noted in place: a command that forgot its `commit()` still compiles and still
//! returns `Ok`, and only a read taken after the command returned can tell the difference.

use crate::helpers;

use arlesh_lib::{
    commands::{
        domains::duplicate_domain,
        infos::duplicate_info,
        tasks::{duplicate_goal, duplicate_task},
    },
    domains::model::{CreateDomainRequest, DomainId, DomainSubtype, ProjectStatus},
    duplicate::{duplicate_subtree, DuplicableKind},
    infos::model::{CreateInfoRequest, InfoId, UpdateInfoRequest},
    knowledge_base::model::CreatePersonRequest,
    scopes::model::ScopeKind,
    tasks::{
        add_task_dependency, create_goal, create_task,
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, GoalId, GoalStatus, OnScopeExit,
            TaskAgentic, TaskArchival, TaskId, TaskStatus, TimeScope, UpdateGoalRequest,
            UpdateTaskRequest,
        },
        update_goal, update_task,
    },
};
use chrono::NaiveDate;
use tauri::Manager;

// ===========================================================================
// Fixtures. Each `tests/*.rs` file is its own crate, so these are local by necessity.
// ===========================================================================

/// The fixed "Growth" aspect's id — the anchor every domain-table fixture hangs off.
async fn growth_aspect_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Creates a domain-table row under `parent_id` and returns its id.
async fn make_domain(
    pool: &sqlx::SqlitePool,
    title: &str,
    subtype: DomainSubtype,
    parent_id: i64,
) -> i64 {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: title.into(),
            description: None,
            subtype,
            parent_id: Some(parent_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

/// The canonical week containing `date`, instantiated on first use.
async fn week_scope(pool: &sqlx::SqlitePool, date: NaiveDate) -> i64 {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .scopes()
        .get_or_create(ScopeKind::Week, date)
        .await
        .unwrap()
        .id
}

/// A single-scope Time Scope, the form both fixtures and assertions use here.
fn at(scope_id: i64) -> TimeScope {
    TimeScope { start_id: scope_id, end_id: scope_id, duration: None }
}

/// Titles of every row in a table, so a clone can be found by what it says rather than by id.
async fn titles(pool: &sqlx::SqlitePool, table: &str, column: &str) -> Vec<String> {
    sqlx::query_scalar(&format!("SELECT {column} FROM {table} ORDER BY id"))
        .fetch_all(pool)
        .await
        .unwrap()
}

/// How many rows of `table` carry `title` — 1 before a duplicate, 2 after.
async fn count_titled(pool: &sqlx::SqlitePool, table: &str, column: &str, title: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?"))
        .bind(title)
        .fetch_one(pool)
        .await
        .unwrap()
}

// ===========================================================================
// The shape of the copy
// ===========================================================================

#[tokio::test]
async fn duplicating_a_project_clones_its_whole_subtree_and_leaves_the_original_in_place() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Rocket", DomainSubtype::Project, aspect).await;
    let engines = make_domain(&pool, "Engines", DomainSubtype::Domain, project).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Reach orbit".into(),
            parent_type: "project".into(),
            parent_id: engines,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Cast the bell".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.infos()
        .create(CreateInfoRequest {
            body: "Nozzle notes".into(),
            details: Some("Bell ratio 40:1".into()),
            parent_type: "task".into(),
            parent_id: task.id,
            position: 0,
        })
        .await
        .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_domain(app.state(), project, aspect, 500).await.unwrap();

    // The copy is its own row, under the paste target, at the position the paste asked for, and
    // titled exactly as the original — there is no " (copy)" suffix.
    assert_ne!(copy.id, project);
    assert_eq!(copy.title, "Rocket");
    assert_eq!(copy.parent_id, Some(aspect));
    assert_eq!(copy.position, 500);

    // Every level below came with it, once each.
    assert_eq!(count_titled(&pool, "domains", "title", "Rocket").await, 2);
    assert_eq!(count_titled(&pool, "domains", "title", "Engines").await, 2);
    assert_eq!(count_titled(&pool, "goals", "title", "Reach orbit").await, 2);
    assert_eq!(count_titled(&pool, "tasks", "title", "Cast the bell").await, 2);
    assert_eq!(count_titled(&pool, "infos", "body", "Nozzle notes").await, 2);

    // …and the copy is a tree, not a flat pile: each clone hangs off the clone above it.
    let engines_copy: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Engines' AND parent_id = ?")
            .bind(copy.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let goal_copy: i64 = sqlx::query_scalar(
        "SELECT id FROM goals WHERE parent_type = 'project' AND parent_id = ?",
    )
    .bind(engines_copy)
    .fetch_one(&pool)
    .await
    .unwrap();
    let task_copy: i64 =
        sqlx::query_scalar("SELECT id FROM tasks WHERE parent_type = 'goal' AND parent_id = ?")
            .bind(goal_copy)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_ne!(task_copy, task.id);
    let info_details: Option<String> = sqlx::query_scalar(
        "SELECT details FROM infos WHERE parent_type = 'task' AND parent_id = ?",
    )
    .bind(task_copy)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(info_details.as_deref(), Some("Bell ratio 40:1"));

    // The original is exactly where it was, with its own subtree still attached.
    let original = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .get(DomainId(project))
        .await
        .unwrap();
    assert_eq!(original.parent_id, Some(aspect));
    let still_under_engines: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM goals WHERE parent_id = ? AND parent_type = 'project'")
            .bind(engines)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(still_under_engines, 1, "the original goal did not move");
}

#[tokio::test]
async fn an_independent_copy_does_not_change_when_the_original_is_edited() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Rocket", DomainSubtype::Project, aspect).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Cast the bell".into(),
            parent_type: "project".into(),
            parent_id: project,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_task(app.state(), task.id, "project".into(), project, 10).await.unwrap();

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_task(
        &mut db,
        TaskId(task.id),
        UpdateTaskRequest {
            title: Some("Cast the bell, again".into()),
            status: Some(TaskStatus::Done),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let stored = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .get(TaskId(copy.id))
        .await
        .unwrap();
    assert_eq!(stored.title, "Cast the bell");
    assert_eq!(stored.status, "todo");
}

// ===========================================================================
// What the copy carries
// ===========================================================================

#[tokio::test]
async fn a_duplicated_task_carries_every_field_the_original_held() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Rocket", DomainSubtype::Project, aspect).await;
    let tag = make_domain(&pool, "urgent", DomainSubtype::Tag, project).await;
    let target = make_domain(&pool, "Landing", DomainSubtype::Domain, aspect).await;
    let week = week_scope(&pool, NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let person = db
        .people()
        .create(CreatePersonRequest { name: "Ada".into(), aliases: None, linked_note: None })
        .await
        .unwrap()
        .id;
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Cast the bell".into(),
            parent_type: "project".into(),
            parent_id: project,
            status: Some(TaskStatus::InProgress),
            time_scope: Some(at(week)),
            on_scope_exit: Some(OnScopeExit::Archive),
            plan: Some(at(week)),
            archival: None,
            agentic: Some(TaskAgentic::Yes),
        },
    )
    .await
    .unwrap();
    update_task(
        &mut db,
        TaskId(task.id),
        UpdateTaskRequest {
            delegate_to: Some(Some(person)),
            is_private: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.tasks().add_tag(TaskId(task.id), tag).await.unwrap();
    db.block_reasons()
        .set("task", task.id, &["waiting on the foundry".to_string()])
        .await
        .unwrap();
    db.tasks().set_beads_id(TaskId(task.id), Some("Arlesh-je5".into())).await.unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_task(app.state(), task.id, "project".into(), target, 77).await.unwrap();

    assert_ne!(copy.id, task.id);
    assert_eq!(copy.title, "Cast the bell");
    assert_eq!(copy.status, "in_progress");
    assert_eq!(copy.parent_id, target);
    assert_eq!(copy.position, 77);
    assert_eq!(copy.time_scope, Some(at(week)));
    assert_eq!(copy.on_scope_exit, Some(OnScopeExit::Archive));
    assert_eq!(copy.plan, Some(at(week)));
    assert_eq!(copy.delegate_to, Some(person));
    assert_eq!(
        copy.agentic,
        Some(true),
        "the Agentic flag carries, and carries independently of the delegate"
    );
    assert!(copy.is_private);
    assert_eq!(copy.tag_ids, vec![tag], "the copy keeps the original's tags, not copies of them");
    assert_eq!(
        copy.beads_id.as_deref(),
        Some("Arlesh-je5"),
        "the issue link carries — the one Tauri-reachable write of beads_id"
    );

    let reasons = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .block_reasons()
        .list_for("task", copy.id)
        .await
        .unwrap();
    assert_eq!(reasons, vec!["waiting on the foundry".to_string()]);
}

/// A copy of a Task that was set aside is set aside too. The clone carries status, plan, privacy,
/// delegate, tags and block reasons; dropping only the Backlog would discard the one thing the user
/// had deliberately said about this Task, silently. The stored invariant
/// `archival = Backlog => plan IS NULL` survives because both fields are copied from an original
/// that already satisfies it.
#[tokio::test]
async fn a_duplicated_task_is_set_aside_if_the_original_was() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Rocket", DomainSubtype::Project, aspect).await;
    let target = make_domain(&pool, "Landing", DomainSubtype::Domain, aspect).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Re-cast the bell".into(),
            parent_type: "project".into(),
            parent_id: project,
            status: Some(TaskStatus::InProgress),
            time_scope: None,
            on_scope_exit: None,
            plan: None,
            archival: Some(TaskArchival::Backlog),
            agentic: None,
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let cloned = duplicate_subtree(&mut db, DuplicableKind::Task, task.id, "domain", target, 0)
        .await
        .unwrap();
    db.commit().await.unwrap();

    let copy = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .get(TaskId(cloned))
        .await
        .unwrap();
    assert_eq!(copy.archival, TaskArchival::Backlog, "the copy is set aside, as the original was");
    assert!(copy.plan.is_none(), "and still unplanned, so the invariant holds");
}

#[tokio::test]
async fn a_duplicated_goal_carries_status_scope_tags_reasons_and_its_issue_link() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Rocket", DomainSubtype::Project, aspect).await;
    let tag = make_domain(&pool, "stretch", DomainSubtype::Tag, project).await;
    let week = week_scope(&pool, NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Reach orbit".into(),
            parent_type: "project".into(),
            parent_id: project,
            status: Some(GoalStatus::Frozen),
            time_scope: Some(at(week)),
            on_scope_exit: Some(OnScopeExit::Archive),
        },
    )
    .await
    .unwrap();
    update_goal(
        &mut db,
        GoalId(goal.id),
        UpdateGoalRequest { is_private: Some(true), ..Default::default() },
    )
    .await
    .unwrap();
    db.goals().add_tag(GoalId(goal.id), tag).await.unwrap();
    db.block_reasons().set("goal", goal.id, &["no launch window".to_string()]).await.unwrap();
    db.goals().set_beads_id(GoalId(goal.id), Some("Arlesh-a4u".into())).await.unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_goal(app.state(), goal.id, "project".into(), project, 9).await.unwrap();

    assert_eq!(copy.title, "Reach orbit");
    assert_eq!(copy.status, "frozen");
    assert_eq!(copy.time_scope, Some(at(week)));
    assert_eq!(copy.on_scope_exit, Some(OnScopeExit::Archive));
    assert_eq!(copy.position, 9);
    assert!(copy.is_private);
    assert_eq!(copy.tag_ids, vec![tag]);
    assert_eq!(copy.beads_id.as_deref(), Some("Arlesh-a4u"));

    let reasons = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .block_reasons()
        .list_for("goal", copy.id)
        .await
        .unwrap();
    assert_eq!(reasons, vec!["no launch window".to_string()]);
}

#[tokio::test]
async fn a_duplicated_project_carries_its_description_status_directory_and_issue_link() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;

    let project = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: "Rocket".into(),
            description: Some("Build a rocket".into()),
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect),
            status: Some(ProjectStatus::Frozen),
            knowledge_base_directory: Some("Vault/Rocket".into()),
        })
        .await
        .unwrap();
    helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .set_beads_id(DomainId(project.id), Some("Arlesh-n66".into()))
        .await
        .unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_domain(app.state(), project.id, aspect, 3).await.unwrap();

    assert_eq!(copy.subtype, "project");
    assert_eq!(copy.description.as_deref(), Some("Build a rocket"));
    assert_eq!(copy.status.as_deref(), Some("frozen"));
    assert_eq!(copy.knowledge_base_directory.as_deref(), Some("Vault/Rocket"));
    assert_eq!(copy.beads_id.as_deref(), Some("Arlesh-n66"));
}

#[tokio::test]
async fn a_duplicated_info_carries_its_details_and_privacy() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Rocket", DomainSubtype::Project, aspect).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Nozzle notes".into(),
            details: Some("Bell ratio 40:1".into()),
            parent_type: "project".into(),
            parent_id: project,
            position: 0,
        })
        .await
        .unwrap();
    db.infos()
        .update(
            InfoId(info.id),
            UpdateInfoRequest { is_private: Some(true), ..Default::default() },
        )
        .await
        .unwrap();
    db.infos()
        .create(CreateInfoRequest {
            body: "Sub-note".into(),
            details: None,
            parent_type: "info".into(),
            parent_id: info.id,
            position: 0,
        })
        .await
        .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_info(app.state(), info.id, "project".into(), project, 4).await.unwrap();

    assert_eq!(copy.body, "Nozzle notes");
    assert_eq!(copy.details.as_deref(), Some("Bell ratio 40:1"));
    assert_eq!(copy.position, 4);
    assert!(copy.is_private);
    let nested: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM infos WHERE parent_type = 'info' AND parent_id = ?")
            .bind(copy.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nested, 1, "an info's own children come with it");
}

// ===========================================================================
// Dependencies
// ===========================================================================

#[tokio::test]
async fn a_copied_task_waits_on_the_same_things_the_original_waits_on() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Rocket", DomainSubtype::Project, aspect).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let outside_goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Funding".into(),
            parent_type: "project".into(),
            parent_id: project,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let parent_task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Assemble".into(),
            parent_type: "project".into(),
            parent_id: project,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // Both ends of this edge are inside the subtree about to be copied.
    let inner_a = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Cast the bell".into(),
            parent_type: "task".into(),
            parent_id: parent_task.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let inner_b = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Mill the throat".into(),
            parent_type: "task".into(),
            parent_id: parent_task.id,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    add_task_dependency(&mut db, TaskId(inner_a.id), Dependency::Task { id: inner_b.id })
        .await
        .unwrap();
    add_task_dependency(&mut db, TaskId(inner_a.id), Dependency::Goal { id: outside_goal.id })
        .await
        .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_task(app.state(), parent_task.id, "project".into(), project, 20)
        .await
        .unwrap();

    let copied_a: i64 = sqlx::query_scalar(
        "SELECT id FROM tasks WHERE title = 'Cast the bell' AND parent_id = ? AND parent_type = 'task'",
    )
    .bind(copy.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let deps = db.tasks().list_dependencies(TaskId(copied_a)).await.unwrap();
    drop(db);

    let mut targets: Vec<(String, i64)> = deps
        .into_iter()
        .map(|dep| match dep {
            Dependency::Task { id } => ("task".to_string(), id),
            Dependency::Goal { id } => ("goal".to_string(), id),
        })
        .collect();
    targets.sort();
    let mut expected = vec![
        ("task".to_string(), inner_b.id),
        ("goal".to_string(), outside_goal.id),
    ];
    expected.sort();
    assert_eq!(
        targets, expected,
        "a copied dependency points at the original's target, copied or not — see the module docs"
    );
}

// ===========================================================================
// Refusals and atomicity
// ===========================================================================

#[tokio::test]
async fn duplicating_an_aspect_is_refused() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;
    let before = titles(&pool, "domains", "title").await;

    let app = helpers::command_host(&pool);
    let refused = duplicate_domain(app.state(), aspect, aspect, 0).await;

    assert!(refused.is_err(), "an aspect is a fixed, seeded root — there is no second Growth");
    assert_eq!(titles(&pool, "domains", "title").await, before, "and nothing was written");
}

/// A duplicate that fails on a *descendant* leaves nothing behind — not even the root it had
/// already written.
///
/// The failure is real rather than injected: the goal's Time Scope is narrowed to a week its
/// child task's window falls outside of (an update validates a node against its parent, not
/// against its descendants, so the stored tree can reach this state). Cloning the goal then
/// succeeds and cloning the task under it violates containment, which is exactly the shape the
/// atomicity requirement is about — a failure part-way, after a write has landed.
#[tokio::test]
async fn a_duplicate_that_fails_part_way_leaves_the_tree_untouched() {
    let pool = helpers::test_pool().await;
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Rocket", DomainSubtype::Project, aspect).await;
    let july = week_scope(&pool, NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()).await;
    let august = week_scope(&pool, NaiveDate::from_ymd_opt(2026, 8, 15).unwrap()).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Reach orbit".into(),
            parent_type: "project".into(),
            parent_id: project,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    create_task(
        &mut db,
        CreateTaskRequest {
            title: "Cast the bell".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            time_scope: Some(at(july)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    update_goal(
        &mut db,
        GoalId(goal.id),
        UpdateGoalRequest { time_scope: Some(Some(at(august))), ..Default::default() },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    // First, on a session of our own, that the failure really is part-way: the goal clone has
    // already landed inside the transaction when the task clone is refused. Without this the
    // command assertion below would hold vacuously, for a duplicate that never wrote anything.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let refused =
        duplicate_subtree(&mut db, DuplicableKind::Goal, goal.id, "project", project, 30).await;
    assert!(refused.is_err(), "the descendant's window escapes the cloned goal's");
    let inside = db.goals().list().await.unwrap();
    let clones_inside = inside.iter().filter(|g| g.title == "Reach orbit").count();
    assert_eq!(clones_inside, 2, "the goal clone landed before the task clone was refused");
    drop(db);

    // Then, through the command, that the caller sees the refusal and the tree is as it was.
    let app = helpers::command_host(&pool);
    let refused = duplicate_goal(app.state(), goal.id, "project".into(), project, 30).await;

    assert!(refused.is_err());
    assert_eq!(
        count_titled(&pool, "goals", "title", "Reach orbit").await,
        1,
        "the goal clone that had already landed was rolled back with the rest"
    );
    assert_eq!(count_titled(&pool, "tasks", "title", "Cast the bell").await, 1);
}
