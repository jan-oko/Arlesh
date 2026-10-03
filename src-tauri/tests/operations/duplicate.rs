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
        flows as flow_commands,
        infos::duplicate_info,
        tasks::{duplicate_goal, duplicate_task},
    },
    domains::model::{CreateDomainRequest, DomainId, DomainSubtype, ProjectStatus},
    duplicate::{duplicate_subtree, DuplicableKind},
    flows::{
        self,
        model::{
            ClockKind, CreateFlowItemRequest, CreateFlowRequest, Flow, InstanceType,
            SetRecurrenceRequest, StartFlowRequest, TargetRef,
        },
    },
    infos::model::{CreateInfoRequest, InfoId, UpdateInfoRequest},
    knowledge_base::model::CreatePersonRequest,
    nodes::key::{OccurrenceKey, TemplateItem, TemplateKind},
    scopes::{key::ScopeKey, model::ScopeKind},
    tasks::{
        add_task_dependency, create_commitment, create_expectation, create_goal, create_task,
        model::{
            CreateCommitmentRequest, CreateExpectationRequest, CreateGoalRequest,
            CreateTaskRequest, Dependency, GoalId, GoalStatus, OnScopeExit, TaskAgentic,
            TaskArchival, TaskId, TimeScope, UpdateGoalRequest, UpdateTaskRequest, Verdict,
        },
        update_goal, update_task,
    },
};
use chrono::NaiveDate;
use helpers::StoredId;
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
async fn week_scope(_pool: &sqlx::SqlitePool, date: NaiveDate) -> ScopeKey {
    arlesh_lib::scopes::model::Scope::containing(ScopeKind::Week, date)
        .unwrap()
        .id
}

/// A single-scope Time Scope, the form both fixtures and assertions use here.
fn at(scope_id: ScopeKey) -> TimeScope {
    TimeScope {
        start_id: scope_id,
        end_id: scope_id,
        duration: None,
    }
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
            parent_id: engines.into(),
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
            parent_id: goal.id.clone(),
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
            parent_id: task.id.clone(),
            position: 0,
        })
        .await
        .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_domain(app.state(), project, aspect, 500)
        .await
        .unwrap()
        .copy;

    // The copy is its own row, under the paste target, at the position the paste asked for, and
    // titled exactly as the original — there is no " (copy)" suffix.
    assert_ne!(copy.id, project);
    assert_eq!(copy.title, "Rocket");
    assert_eq!(copy.parent_id, Some(aspect));
    assert_eq!(copy.position, 500);

    // Every level below came with it, once each.
    assert_eq!(count_titled(&pool, "domains", "title", "Rocket").await, 2);
    assert_eq!(count_titled(&pool, "domains", "title", "Engines").await, 2);
    assert_eq!(
        count_titled(&pool, "goals", "title", "Reach orbit").await,
        2
    );
    assert_eq!(
        count_titled(&pool, "tasks", "title", "Cast the bell").await,
        2
    );
    assert_eq!(
        count_titled(&pool, "infos", "body", "Nozzle notes").await,
        2
    );

    // …and the copy is a tree, not a flat pile: each clone hangs off the clone above it.
    let engines_copy: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Engines' AND parent_id = ?")
            .bind(copy.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let goal_copy: i64 =
        sqlx::query_scalar("SELECT id FROM goals WHERE parent_type = 'project' AND parent_id = ?")
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
    let still_under_engines: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM goals WHERE parent_id = ? AND parent_type = 'project'",
    )
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
            parent_id: project.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_task(app.state(), task.id.sid(), "project".into(), project, 10)
        .await
        .unwrap()
        .copy;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    update_task(
        &mut db,
        TaskId(task.id.sid()),
        UpdateTaskRequest {
            title: Some("Cast the bell, again".into()),
            status: Some(arlesh_lib::tasks::model::Status::Ordinary(
                arlesh_lib::tasks::model::TaskStatus::Done,
            )),
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
        .get(TaskId(copy.id.sid()))
        .await
        .unwrap();
    assert_eq!(stored.title, "Cast the bell");
    assert_eq!(stored.status.as_str(), "todo");
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
        .create(CreatePersonRequest {
            name: "Ada".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap()
        .id;
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Cast the bell".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            status: Some(arlesh_lib::tasks::model::Status::Agentic(
                arlesh_lib::tasks::model::AgenticStatus::Doing,
            )),
            time_scope: Some(at(week)),
            on_scope_exit: Some(OnScopeExit::Archive),
            plan: Some(at(week)),
            due_scope: None,
            archival: None,
            agentic: Some(TaskAgentic::Yes),
            asynchronous: Some(true),
            compound: None,
            async_template: None,
            agentic_brief: Some(arlesh_lib::tasks::model::AgenticBrief {
                priority: Some(arlesh_lib::tasks::model::AgenticPriority::A),
                spec: "Pour at dawn".into(),
                ..Default::default()
            }),
        },
    )
    .await
    .unwrap();
    update_task(
        &mut db,
        TaskId(task.id.sid()),
        UpdateTaskRequest {
            delegate_to: Some(Some(arlesh_lib::tasks::model::Delegate::Person {
                id: person,
            })),
            is_private: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.tasks()
        .add_tag(TaskId(task.id.sid()), tag)
        .await
        .unwrap();
    db.block_reasons()
        .set(
            "task",
            task.id.sid(),
            &["waiting on the foundry".to_string()],
        )
        .await
        .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_task(app.state(), task.id.sid(), "project".into(), target, 77)
        .await
        .unwrap()
        .copy;

    assert_ne!(copy.id, task.id);
    assert_eq!(copy.title, "Cast the bell");
    assert_eq!(
        copy.status,
        arlesh_lib::tasks::model::Status::Agentic(arlesh_lib::tasks::model::AgenticStatus::Doing)
    );
    assert_eq!(
        copy.agentic_brief
            .as_ref()
            .map(|brief| (brief.priority, brief.spec.as_str())),
        Some((
            Some(arlesh_lib::tasks::model::AgenticPriority::A),
            "Pour at dawn"
        )),
        "the brief is the task's own, and a copy carries it"
    );
    assert_eq!(copy.parent_id, target);
    assert_eq!(copy.position, 77);
    assert_eq!(copy.time_scope, Some(at(week)));
    assert_eq!(copy.on_scope_exit, Some(OnScopeExit::Archive));
    assert_eq!(copy.plan, Some(at(week)));
    assert_eq!(
        copy.delegate_to,
        Some(arlesh_lib::tasks::model::Delegate::Person { id: person })
    );
    assert_eq!(
        copy.agentic,
        Some(true),
        "the Agentic flag carries, and carries independently of the delegate"
    );
    assert!(
        copy.asynchronous,
        "the Asynchronous flag carries: the copy is the same action, so it starts the same wait"
    );
    assert!(copy.is_private);
    assert_eq!(
        copy.tag_ids,
        vec![tag],
        "the copy keeps the original's tags, not copies of them"
    );

    let reasons = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .block_reasons()
        .list_for("task", copy.id.sid())
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
            parent_id: project.into(),
            status: Some(arlesh_lib::tasks::model::Status::Ordinary(
                arlesh_lib::tasks::model::TaskStatus::InProgress,
            )),
            time_scope: None,
            on_scope_exit: None,
            plan: None,
            due_scope: None,
            archival: Some(TaskArchival::Backlog),
            agentic: None,
            asynchronous: None,
            compound: None,
            async_template: None,
            agentic_brief: None,
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let cloned = duplicate_subtree(
        &mut db,
        DuplicableKind::Task,
        task.id.sid(),
        "domain",
        target,
        0,
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let copy = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .get(TaskId(cloned.root_id))
        .await
        .unwrap();
    assert_eq!(
        copy.archival,
        TaskArchival::Backlog,
        "the copy is set aside, as the original was"
    );
    assert!(
        copy.plan.is_none(),
        "and still unplanned, so the invariant holds"
    );
}

#[tokio::test]
async fn a_duplicated_goal_carries_status_scope_tags_and_reasons() {
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
            parent_id: project.into(),
            status: Some(GoalStatus::Frozen),
            time_scope: Some(at(week)),
            on_scope_exit: Some(OnScopeExit::Archive),
        },
    )
    .await
    .unwrap();
    update_goal(
        &mut db,
        GoalId(goal.id.sid()),
        UpdateGoalRequest {
            is_private: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.goals()
        .add_tag(GoalId(goal.id.sid()), tag)
        .await
        .unwrap();
    db.block_reasons()
        .set("goal", goal.id.sid(), &["no launch window".to_string()])
        .await
        .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_goal(app.state(), goal.id.sid(), "project".into(), project, 9)
        .await
        .unwrap()
        .copy;

    assert_eq!(copy.title, "Reach orbit");
    assert_eq!(copy.status.as_str(), "frozen");
    assert_eq!(copy.time_scope, Some(at(week)));
    assert_eq!(copy.on_scope_exit, Some(OnScopeExit::Archive));
    assert_eq!(copy.position, 9);
    assert!(copy.is_private);
    assert_eq!(copy.tag_ids, vec![tag]);

    let reasons = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .block_reasons()
        .list_for("goal", copy.id.sid())
        .await
        .unwrap();
    assert_eq!(reasons, vec!["no launch window".to_string()]);
}

#[tokio::test]
async fn a_duplicated_project_carries_its_description_status_and_directory() {
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

    let app = helpers::command_host(&pool);
    let copy = duplicate_domain(app.state(), project.id, aspect, 3)
        .await
        .unwrap()
        .copy;

    assert_eq!(copy.subtype, "project");
    assert_eq!(copy.description.as_deref(), Some("Build a rocket"));
    assert_eq!(copy.status.as_deref(), Some("frozen"));
    assert_eq!(
        copy.knowledge_base_directory.as_deref(),
        Some("Vault/Rocket")
    );
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
            parent_id: project.into(),
            position: 0,
        })
        .await
        .unwrap();
    db.infos()
        .update(
            InfoId(info.id),
            UpdateInfoRequest {
                is_private: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    db.infos()
        .create(CreateInfoRequest {
            body: "Sub-note".into(),
            details: None,
            parent_type: "info".into(),
            parent_id: info.id.into(),
            position: 0,
        })
        .await
        .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_info(app.state(), info.id, "project".into(), project, 4)
        .await
        .unwrap()
        .copy;

    assert_eq!(copy.body, "Nozzle notes");
    assert_eq!(copy.details.as_deref(), Some("Bell ratio 40:1"));
    assert_eq!(copy.position, 4);
    assert!(copy.is_private);
    let nested: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM infos WHERE parent_type = 'info' AND parent_id = ?",
    )
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
            parent_id: project.into(),
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
            parent_id: project.into(),
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
            parent_id: parent_task.id.clone(),
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
            parent_id: parent_task.id.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    add_task_dependency(
        &mut db,
        TaskId(inner_a.id.sid()),
        Dependency::Task {
            id: inner_b.id.clone(),
        },
    )
    .await
    .unwrap();
    add_task_dependency(
        &mut db,
        TaskId(inner_a.id.sid()),
        Dependency::Goal {
            id: outside_goal.id.clone(),
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let app = helpers::command_host(&pool);
    let copy = duplicate_task(
        app.state(),
        parent_task.id.sid(),
        "project".into(),
        project,
        20,
    )
    .await
    .unwrap()
    .copy;

    let copied_a: i64 = sqlx::query_scalar(
        "SELECT id FROM tasks WHERE title = 'Cast the bell' AND parent_id = ? AND parent_type = 'task'",
    )
    .bind(copy.id.sid())
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();
    let deps = db
        .tasks()
        .list_dependencies(TaskId(copied_a))
        .await
        .unwrap();
    drop(db);

    let mut targets: Vec<(String, i64)> = deps
        .into_iter()
        .map(|dep| match dep {
            Dependency::Task { id } => ("task".to_string(), id.sid()),
            Dependency::Goal { id } => ("goal".to_string(), id.sid()),
            Dependency::Expectation { id } => ("expectation".to_string(), id),
        })
        .collect();
    targets.sort();
    let mut expected = vec![
        ("task".to_string(), inner_b.id.sid()),
        ("goal".to_string(), outside_goal.id.sid()),
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

    assert!(
        refused.is_err(),
        "an aspect is a fixed, seeded root — there is no second Growth"
    );
    assert_eq!(
        titles(&pool, "domains", "title").await,
        before,
        "and nothing was written"
    );
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
            parent_id: project.into(),
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
            parent_id: goal.id.clone(),
            time_scope: Some(at(july)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    update_goal(
        &mut db,
        GoalId(goal.id.sid()),
        UpdateGoalRequest {
            time_scope: Some(Some(at(august))),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    // First, on a session of our own, that the failure really is part-way: the goal clone has
    // already landed inside the transaction when the task clone is refused. Without this the
    // command assertion below would hold vacuously, for a duplicate that never wrote anything.
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let refused = duplicate_subtree(
        &mut db,
        DuplicableKind::Goal,
        goal.id.sid(),
        "project",
        project,
        30,
    )
    .await;
    assert!(
        refused.is_err(),
        "the descendant's window escapes the cloned goal's"
    );
    let inside = db.goals().list().await.unwrap();
    let clones_inside = inside.iter().filter(|g| g.title == "Reach orbit").count();
    assert_eq!(
        clones_inside, 2,
        "the goal clone landed before the task clone was refused"
    );
    drop(db);

    // Then, through the command, that the caller sees the refusal and the tree is as it was.
    let app = helpers::command_host(&pool);
    let refused = duplicate_goal(app.state(), goal.id.sid(), "project".into(), project, 30).await;

    assert!(refused.is_err());
    assert_eq!(
        count_titled(&pool, "goals", "title", "Reach orbit").await,
        1,
        "the goal clone that had already landed was rolled back with the rest"
    );
    assert_eq!(
        count_titled(&pool, "tasks", "title", "Cast the bell").await,
        1
    );
}

// ===========================================================================
// Flows under a copied node (e2c)
// ===========================================================================

/// A day-long Habit starting 2026-01-05 under `(parent_type, parent_id)`, pointed at `target`.
async fn habit_under(
    app: &tauri::App<tauri::test::MockRuntime>,
    title: &str,
    parent: (&str, i64),
    target: Option<(&str, i64)>,
) -> i64 {
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: title.into(),
            instance_type: Some(InstanceType::Task),
            parent_type: parent.0.into(),
            parent_id: parent.1,
            target_type: target.map(|(kind, _)| kind.to_string()),
            target_id: target.map(|(_, id)| id),
            flow_duration_n: Some(1),
            flow_duration_kind: Some("day".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    flow_commands::set_flow_recurrence(
        app.state(),
        flow.id,
        SetRecurrenceRequest {
            start_scope_id: ScopeKey::day(NaiveDate::from_ymd_opt(2026, 1, 5).unwrap()),
            gap_n: None,
            gap_kind: None,
            end_scope_id: None,
            clock: ClockKind::Interval,
            miss_policy: None,
            cooldown_n: None,
            cooldown_kind: None,
        },
    )
    .await
    .unwrap();
    flow.id
}

/// The Habit's root occurrence in its first iteration.
fn first_occurrence(flow_id: i64) -> OccurrenceKey {
    OccurrenceKey {
        item: TemplateItem {
            item_type: TemplateKind::FlowRoot,
            item_id: flow_id,
        },
        iteration: ScopeKey::day(NaiveDate::from_ymd_opt(2026, 1, 5).unwrap()),
        cycle: 0,
    }
}

/// Every Flow titled `title`, oldest first: the original, then its copies.
async fn flows_titled(pool: &sqlx::SqlitePool, title: &str) -> Vec<Flow> {
    let mut db = helpers::session_factory(pool).connect().await.unwrap();
    let mut flows: Vec<Flow> = db
        .flows()
        .list()
        .await
        .unwrap()
        .into_iter()
        .filter(|flow| flow.title == title)
        .collect();
    flows.sort_by_key(|flow| flow.id);
    flows
}

#[tokio::test]
async fn a_flow_under_a_copied_project_comes_with_it_and_its_target_follows_the_copy() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Rocket", DomainSubtype::Project, aspect).await;
    let elsewhere = make_domain(&pool, "Launchpad", DomainSubtype::Project, aspect).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Reach orbit".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    let inside = habit_under(
        &app,
        "Inspect",
        ("project", project),
        Some(("goal", goal.id.sid())),
    )
    .await;
    let outside = habit_under(
        &app,
        "Sweep",
        ("project", project),
        Some(("project", elsewhere)),
    )
    .await;
    let parental = habit_under(&app, "Log", ("goal", goal.id.sid()), None).await;

    let pasted = duplicate_domain(app.state(), project, aspect, 9)
        .await
        .unwrap();

    let goal_copy: i64 =
        sqlx::query_scalar("SELECT id FROM goals WHERE title = 'Reach orbit' AND parent_id = ?")
            .bind(pasted.copy.id)
            .fetch_one(&pool)
            .await
            .unwrap();

    // A target the copy carried is remapped to the copy of it.
    let [original, copy] = flows_titled(&pool, "Inspect").await.try_into().unwrap();
    assert_eq!(original.id, inside);
    assert_eq!(
        (copy.parent_type.as_str(), copy.parent_id),
        ("project", pasted.copy.id)
    );
    assert_eq!(
        (copy.target_type.as_deref(), copy.target_id),
        (Some("goal"), Some(goal_copy))
    );
    assert_eq!(
        original.target_id,
        Some(goal.id.sid()),
        "the original is untouched"
    );
    assert!(copy.is_habit, "the Recurrence comes with the copy");

    // One outside the copy keeps pointing at the original.
    let [_, copy] = flows_titled(&pool, "Sweep").await.try_into().unwrap();
    assert_ne!(copy.id, outside);
    assert_eq!(
        (copy.target_type.as_deref(), copy.target_id),
        (Some("project"), Some(elsewhere))
    );

    // A NULL target stays NULL, so it follows its copied parent; a Flow under a copied Goal comes.
    let [_, copy] = flows_titled(&pool, "Log").await.try_into().unwrap();
    assert_ne!(copy.id, parental);
    assert_eq!(
        (copy.parent_type.as_str(), copy.parent_id),
        ("goal", goal_copy)
    );
    assert_eq!((copy.target_type, copy.target_id), (None, None));

    assert!(
        pasted.left_behind.is_empty(),
        "nothing was hung on an occurrence"
    );
}

#[tokio::test]
async fn a_row_hung_on_an_occurrence_is_left_behind_and_named_not_copied_loose() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Kitchen", DomainSubtype::Project, aspect).await;
    let elsewhere = make_domain(&pool, "Pantry", DomainSubtype::Project, aspect).await;
    // Hosted on the copied project.
    let hosted = habit_under(&app, "Groceries", ("project", project), None).await;
    // Hosted outside, on a Habit the copy carries.
    let carried = habit_under(
        &app,
        "Stock",
        ("project", project),
        Some(("project", elsewhere)),
    )
    .await;
    // Neither hosted inside nor carried: stays out of the report.
    let unrelated = habit_under(&app, "Dust", ("project", elsewhere), None).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    for (flow, title) in [
        (hosted, "buy milk"),
        (carried, "count tins"),
        (unrelated, "wipe shelf"),
    ] {
        flows::create_instance_child(&mut db, &first_occurrence(flow), "task", title.into())
            .await
            .unwrap();
    }
    flows::create_instance_child(
        &mut db,
        &first_occurrence(hosted),
        "info",
        "oat, not soy".into(),
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let pasted = duplicate_domain(app.state(), project, aspect, 9)
        .await
        .unwrap();

    let named: Vec<(&str, &str)> = pasted
        .left_behind
        .iter()
        .map(|child| (child.child_type.as_str(), child.title.as_str()))
        .collect();
    assert_eq!(
        named,
        vec![
            ("task", "buy milk"),
            ("task", "count tins"),
            ("info", "oat, not soy")
        ]
    );
    // Not copied as a loose child of the copied host, either.
    assert_eq!(count_titled(&pool, "tasks", "title", "buy milk").await, 1);
    assert_eq!(
        count_titled(&pool, "infos", "body", "oat, not soy").await,
        1
    );
}

// ===========================================================================
// Commitments, waits and started instances under a copied node (e2c)
// ===========================================================================

#[tokio::test]
async fn commitments_and_waits_under_a_copied_project_come_with_their_subtrees() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Health", DomainSubtype::Project, aspect).await;
    let week = week_scope(&pool, NaiveDate::from_ymd_opt(2026, 1, 5).unwrap()).await;

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let prep = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Prep meals".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let pledge = create_commitment(
        &mut db,
        CreateCommitmentRequest {
            title: "No sugar".into(),
            parent_type: "task".into(),
            parent_id: prep.id.clone(),
            verdict: Some(Verdict::Kept),
            time_scope: Some(at(week)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    create_task(
        &mut db,
        CreateTaskRequest {
            title: "Clear the cupboard".into(),
            parent_type: "commitment".into(),
            parent_id: pledge.id.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let wait = create_expectation(
        &mut db,
        CreateExpectationRequest {
            title: "Hear from the dietician".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.infos()
        .create(CreateInfoRequest {
            body: "Called Tuesday".into(),
            details: None,
            parent_type: "expectation".into(),
            parent_id: wait.id.clone(),
            position: 0,
        })
        .await
        .unwrap();
    let waiting = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Book the follow-up".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    add_task_dependency(
        &mut db,
        TaskId(waiting.id.sid()),
        Dependency::Expectation { id: wait.id.sid() },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    sqlx::query(
        "INSERT INTO wait_checks (wait_kind, wait_id, due_at, resolved_at)
         VALUES ('stored', ?, '2026-01-06T09:00:00', '2026-01-06T10:00:00')",
    )
    .bind(wait.id.sid())
    .execute(&pool)
    .await
    .unwrap();

    duplicate_domain(app.state(), project, aspect, 9)
        .await
        .unwrap();

    // The Commitment comes as stored — its verdict too, as a Task keeps its status — under the
    // copied Task, with its own child.
    let pledges: Vec<(String, i64, String)> = sqlx::query_as(
        "SELECT parent_type, parent_id, verdict FROM commitments WHERE title = 'No sugar' ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let [_, (parent_type, parent_id, verdict)] = pledges.try_into().unwrap();
    assert_eq!((parent_type.as_str(), verdict.as_str()), ("task", "kept"));
    assert_ne!(parent_id, prep.id.sid(), "it hangs under the copied Task");
    assert_eq!(
        count_titled(&pool, "tasks", "title", "Clear the cupboard").await,
        2
    );

    // The wait comes with its note and its checks.
    let waits: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM expectations WHERE title = 'Hear from the dietician' ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let [_, wait_copy] = waits.try_into().unwrap();
    assert_eq!(
        count_titled(&pool, "infos", "body", "Called Tuesday").await,
        2
    );
    let checks: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM wait_checks WHERE wait_kind = 'stored' AND wait_id = ?",
    )
    .bind(wait_copy)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(checks, 1);

    // A copied Task's dependency on the wait stays as stored: on the original.
    let copied_waiting: i64 =
        sqlx::query_scalar("SELECT id FROM tasks WHERE title = 'Book the follow-up' AND id <> ?")
            .bind(waiting.id.sid())
            .fetch_one(&pool)
            .await
            .unwrap();
    let dependencies = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .tasks()
        .list_dependencies(TaskId(copied_waiting))
        .await
        .unwrap();
    assert!(
        matches!(dependencies.as_slice(), [Dependency::Expectation { id }] if *id == wait.id.sid()),
        "{dependencies:?}"
    );
}

#[tokio::test]
async fn a_copied_started_instance_still_reads_from_the_original_flow() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let aspect = growth_aspect_id(&pool).await;
    let project = make_domain(&pool, "Product", DomainSubtype::Project, aspect).await;
    let flow = flow_commands::create_flow(
        app.state(),
        CreateFlowRequest {
            title: "Release".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "project".into(),
            parent_id: project,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    flow_commands::create_flow_task(
        app.state(),
        CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Tag the build".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        },
    )
    .await
    .unwrap();
    let started = flow_commands::start_flow(
        app.state(),
        flow.id,
        StartFlowRequest {
            title: "Release 1.0".into(),
            target_type: "project".into(),
            target_id: project,
            anchor_date: NaiveDate::from_ymd_opt(2026, 1, 5).unwrap(),
        },
    )
    .await
    .unwrap();

    duplicate_domain(app.state(), project, aspect, 9)
        .await
        .unwrap();

    let copied: Vec<(String, i64)> = sqlx::query_as(
        "SELECT 'task', id FROM tasks WHERE title IN ('Release 1.0', 'Tag the build') AND id NOT IN
           (SELECT node_id FROM flow_instance_nodes WHERE flow_instance_id =
              (SELECT id FROM flow_instances ORDER BY id LIMIT 1))
         ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(copied.len(), 2, "the root and its step were copied");
    let refs = copied
        .iter()
        .map(|(node_type, node_id)| TargetRef {
            node_type: node_type.clone(),
            node_id: *node_id,
        })
        .collect();
    let origins = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .flows()
        .origins(refs)
        .await
        .unwrap();
    assert_eq!(origins.len(), 2, "each copy still reads 'from flow'");

    // The Flow itself was copied too, but the copies are recorded against the original.
    let runs: Vec<(Option<i64>, String, i64)> =
        sqlx::query_as("SELECT flow_id, root_type, root_id FROM flow_instances ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    let [(first, _, root), (second, _, copied_root)] = runs.try_into().unwrap();
    assert_eq!(root, started.root_id);
    assert_eq!((first, second), (Some(flow.id), Some(flow.id)));
    assert_eq!(
        copied_root, copied[0].1,
        "the copied run is rooted at the copied root"
    );
    assert_eq!(flows_titled(&pool, "Release").await.len(), 2);
}

#[tokio::test]
async fn a_copied_domain_carries_children_whatever_spelling_names_it_as_their_parent() {
    let pool = helpers::test_pool().await;
    let app = helpers::command_host(&pool);
    let aspect = growth_aspect_id(&pool).await;
    let garden = make_domain(&pool, "Garden", DomainSubtype::Domain, aspect).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    for title in ["Water the plants", "Prune the roses"] {
        create_task(
            &mut db,
            CreateTaskRequest {
                title: title.into(),
                parent_type: "project".into(),
                parent_id: garden.into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }
    create_goal(
        &mut db,
        CreateGoalRequest {
            title: "Grow tomatoes".into(),
            parent_type: "project".into(),
            parent_id: garden.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();
    // Some writers name a Domain parent `domain` rather than `project`; the real board holds rows
    // of both. Rewrite two of them to that spelling, as those writers would have stored them.
    sqlx::query("UPDATE tasks SET parent_type = 'domain' WHERE title = 'Water the plants'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE goals SET parent_type = 'domain' WHERE title = 'Grow tomatoes'")
        .execute(&pool)
        .await
        .unwrap();

    let pasted = duplicate_domain(app.state(), garden, aspect, 9)
        .await
        .unwrap();

    for (table, title) in [
        ("tasks", "Water the plants"),
        ("tasks", "Prune the roses"),
        ("goals", "Grow tomatoes"),
    ] {
        let under_copy: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {table} WHERE title = ? AND parent_id = ?"
        ))
        .bind(title)
        .bind(pasted.copy.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(under_copy, 1, "{title} came with the copied Domain");
    }
}
