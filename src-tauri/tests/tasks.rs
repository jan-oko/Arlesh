mod helpers;

use arlesh_lib::{
    domains::{
        model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
        DomainRepository,
    },
    scopes::{model::ScopeKind, ScopeRepository},
    tasks::{
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, DurationSpec, GoalStatus, TaskStatus,
            TimeScope, UpdateGoalRequest, UpdateTaskRequest,
        },
        GoalRepository, TaskRepository,
    },
};

async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    DomainRepository::new(pool)
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

async fn make_tag(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    DomainRepository::new(pool)
        .create(CreateDomainRequest {
            title: "test-tag".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

#[tokio::test]
async fn create_task_and_goal() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = TaskRepository::new(&pool)
        .create(CreateTaskRequest {
            title: "Write tests".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    assert_eq!(task.title, "Write tests");
    assert_eq!(task.status, "todo");
    assert!(task.tag_ids.is_empty());

    let goal = GoalRepository::new(&pool)
        .create(CreateGoalRequest {
            title: "Ship Phase 1".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    assert_eq!(goal.status, "active");
    assert!(goal.tag_ids.is_empty());
}

#[tokio::test]
async fn undone_dependency_blocks_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let dependency = task_repo
        .create(CreateTaskRequest {
            title: "Dependency".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Blocked Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    task_repo
        .add_dependency(task.id.into(), Dependency::Task { id: dependency.id })
        .await
        .unwrap();

    let with_blockers = task_repo.get_with_blockers(task.id.into()).await.unwrap();
    assert_eq!(with_blockers.block_reasons.len(), 1);
    assert!(with_blockers.block_reasons[0].contains("Dependency"));
}

#[tokio::test]
async fn done_dependency_unblocks_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let dependency = task_repo
        .create(CreateTaskRequest {
            title: "Dep".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    task_repo
        .add_dependency(task.id.into(), Dependency::Task { id: dependency.id })
        .await
        .unwrap();

    task_repo
        .update(
            dependency.id.into(),
            UpdateTaskRequest {
                status: Some(arlesh_lib::tasks::model::TaskStatus::Done),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let with_blockers = task_repo.get_with_blockers(task.id.into()).await.unwrap();
    assert!(with_blockers.block_reasons.is_empty(), "should be unblocked");
}

#[tokio::test]
async fn circular_dependency_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let task_a = task_repo
        .create(CreateTaskRequest {
            title: "A".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let task_b = task_repo
        .create(CreateTaskRequest {
            title: "B".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    task_repo
        .add_dependency(task_a.id.into(), Dependency::Task { id: task_b.id })
        .await
        .unwrap();

    let err = task_repo
        .add_dependency(task_b.id.into(), Dependency::Task { id: task_a.id })
        .await
        .unwrap_err();

    assert!(
        matches!(err, arlesh_lib::tasks::error::TaskError::CircularDependency),
        "expected CircularDependency, got {:?}",
        err
    );
}

#[tokio::test]
async fn goal_dependency_blocks_task_until_achieved() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);
    let goal_repo = GoalRepository::new(&pool);

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "The Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    task_repo
        .add_dependency(task.id.into(), Dependency::Goal { id: goal.id })
        .await
        .unwrap();

    let blocked = task_repo.get_with_blockers(task.id.into()).await.unwrap();
    assert_eq!(blocked.block_reasons.len(), 1);

    goal_repo
        .update(
            goal.id.into(),
            UpdateGoalRequest {
                status: Some(GoalStatus::Achieved),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let unblocked = task_repo.get_with_blockers(task.id.into()).await.unwrap();
    assert!(unblocked.block_reasons.is_empty());
}

#[tokio::test]
async fn reparent_task_to_different_project() {
    let pool = helpers::test_pool().await;
    let project_a_id = make_project(&pool).await;
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let project_b_id = DomainRepository::new(&pool)
        .create(CreateDomainRequest {
            title: "Project B".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id;
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Movable Task".into(),
            parent_type: "project".into(),
            parent_id: project_a_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    assert_eq!(task.parent_id, project_a_id);

    let moved = task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest {
                parent_type: Some("project".into()),
                parent_id: Some(project_b_id),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(moved.parent_id, project_b_id);
}

#[tokio::test]
async fn add_and_remove_tag_on_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Tagged Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(task.tag_ids.is_empty());

    task_repo.add_tag(task.id.into(), tag_id).await.unwrap();
    let tagged = task_repo.get(task.id.into()).await.unwrap();
    assert_eq!(tagged.tag_ids, vec![tag_id]);

    task_repo.remove_tag(task.id.into(), tag_id).await.unwrap();
    let untagged = task_repo.get(task.id.into()).await.unwrap();
    assert!(untagged.tag_ids.is_empty());
}

#[tokio::test]
async fn list_tasks_includes_tag_ids() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Task With Tag".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    task_repo.add_tag(task.id.into(), tag_id).await.unwrap();

    let all_tasks = task_repo.list().await.unwrap();
    let found = all_tasks.iter().find(|t| t.id == task.id).unwrap();
    assert_eq!(found.tag_ids, vec![tag_id]);
}

#[tokio::test]
async fn update_task_title() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Old Title".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let updated = task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest { title: Some("New Title".into()), ..Default::default() },
        )
        .await
        .unwrap();

    assert_eq!(updated.title, "New Title");
}

#[tokio::test]
async fn delete_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Doomed Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    task_repo.delete(task.id.into()).await.unwrap();

    let err = task_repo.get(task.id.into()).await.unwrap_err();
    assert!(
        matches!(err, arlesh_lib::tasks::error::TaskError::TaskNotFound(_)),
        "expected TaskNotFound, got {:?}",
        err
    );
}

#[tokio::test]
async fn remove_dependency() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let dep = task_repo
        .create(CreateTaskRequest {
            title: "Dep".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    task_repo
        .add_dependency(task.id.into(), Dependency::Task { id: dep.id })
        .await
        .unwrap();
    task_repo
        .remove_dependency(task.id.into(), Dependency::Task { id: dep.id })
        .await
        .unwrap();

    let deps = task_repo.list_dependencies(task.id.into()).await.unwrap();
    assert!(deps.is_empty());
}

#[tokio::test]
async fn update_goal_title() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let goal_repo = GoalRepository::new(&pool);

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "Old Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let updated = goal_repo
        .update(
            goal.id.into(),
            UpdateGoalRequest { title: Some("New Goal".into()), ..Default::default() },
        )
        .await
        .unwrap();

    assert_eq!(updated.title, "New Goal");
}

#[tokio::test]
async fn delete_goal() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let goal_repo = GoalRepository::new(&pool);

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "Doomed Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    goal_repo.delete(goal.id.into()).await.unwrap();

    let err = goal_repo.get(goal.id.into()).await.unwrap_err();
    assert!(
        matches!(err, arlesh_lib::tasks::error::TaskError::GoalNotFound(_)),
        "expected GoalNotFound, got {:?}",
        err
    );
}

#[tokio::test]
async fn add_and_remove_tag_on_goal() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;
    let goal_repo = GoalRepository::new(&pool);

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "Tagged Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(goal.tag_ids.is_empty());

    goal_repo.add_tag(goal.id.into(), tag_id).await.unwrap();
    let tagged = goal_repo.get(goal.id.into()).await.unwrap();
    assert_eq!(tagged.tag_ids, vec![tag_id]);

    goal_repo.remove_tag(goal.id.into(), tag_id).await.unwrap();
    let untagged = goal_repo.get(goal.id.into()).await.unwrap();
    assert!(untagged.tag_ids.is_empty());
}

#[tokio::test]
async fn list_goals_includes_tag_ids() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let tag_id = make_tag(&pool).await;
    let goal_repo = GoalRepository::new(&pool);

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "Goal With Tag".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    goal_repo.add_tag(goal.id.into(), tag_id).await.unwrap();

    let all_goals = goal_repo.list().await.unwrap();
    let found = all_goals.iter().find(|g| g.id == goal.id).unwrap();
    assert_eq!(found.tag_ids, vec![tag_id]);
}

#[tokio::test]
async fn reparent_goal_to_different_project() {
    let pool = helpers::test_pool().await;
    let project_a_id = make_project(&pool).await;
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let project_b_id = DomainRepository::new(&pool)
        .create(CreateDomainRequest {
            title: "Project B".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id;
    let goal_repo = GoalRepository::new(&pool);

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "Movable Goal".into(),
            parent_type: "project".into(),
            parent_id: project_a_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    assert_eq!(goal.parent_id, project_a_id);

    let moved = goal_repo
        .update(
            goal.id.into(),
            UpdateGoalRequest {
                parent_type: Some("project".into()),
                parent_id: Some(project_b_id),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(moved.parent_id, project_b_id);
}

#[tokio::test]
async fn update_task_status_to_in_progress() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "In Progress Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    assert_eq!(task.status, "todo");

    let updated = task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest { status: Some(TaskStatus::InProgress), ..Default::default() },
        )
        .await
        .unwrap();

    assert_eq!(updated.status, "in_progress");
}

#[tokio::test]
async fn update_task_blocked_reason() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Blockable Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let blocked = task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest {
                blocked_reason: Some("Waiting on design".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(blocked.blocked_reason.as_deref(), Some("Waiting on design"));

    let cleared = task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest { blocked_reason: Some(String::new()), ..Default::default() },
        )
        .await
        .unwrap();

    assert!(cleared.blocked_reason.is_none());
}

#[tokio::test]
async fn explicit_block_reason_surfaces_in_get_with_blockers() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Blocked Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest {
                blocked_reason: Some("Explicit reason".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let with_blockers = task_repo.get_with_blockers(task.id.into()).await.unwrap();
    assert!(with_blockers.block_reasons.iter().any(|r| r.contains("Explicit reason")));
}

#[tokio::test]
async fn update_task_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let scope = ScopeRepository::new(&pool)
        .get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Scoped Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(task.time_scope.is_none());

    let updated = task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest {
                time_scope: Some(Some(TimeScope {
                    start_id: scope.id,
                    end_id: scope.id,
                    duration: None,
                })),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let time_scope = updated.time_scope.expect("time scope set");
    assert_eq!(time_scope.start_id, scope.id);
    assert_eq!(time_scope.end_id, scope.id);
}

#[tokio::test]
async fn task_time_scope_duration_params_round_trip() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);
    let scope = ScopeRepository::new(&pool)
        .get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Duration Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope {
                start_id: scope.id,
                end_id: scope.id,
                duration: Some(DurationSpec { n: 3, kind: "week".into() }),
            }),
            ..Default::default()
        })
        .await
        .unwrap();

    // The snapshotted window persists alongside the remembered duration parameters.
    let duration = task.time_scope.and_then(|ts| ts.duration).expect("duration kept");
    assert_eq!(duration.n, 3);
    assert_eq!(duration.kind, "week");
}

#[tokio::test]
async fn task_plan_is_independent_of_time_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);
    let scope_repo = ScopeRepository::new(&pool);
    let week = scope_repo
        .get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();
    let day = scope_repo
        .get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Planned Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            plan_scope_id: Some(day.id),
            ..Default::default()
        })
        .await
        .unwrap();

    assert_eq!(task.time_scope.expect("time scope").start_id, week.id);
    assert_eq!(task.plan_scope_id, Some(day.id));

    // Clearing the Plan leaves the Time Scope intact.
    let cleared = task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest { plan_scope_id: Some(None), ..Default::default() },
        )
        .await
        .unwrap();
    assert!(cleared.plan_scope_id.is_none());
    assert!(cleared.time_scope.is_some(), "clearing Plan must not clear Time Scope");
}

#[tokio::test]
async fn plan_within_time_scope_is_accepted() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let scope_repo = ScopeRepository::new(&pool);
    // 2026-07-01 (Wed) sits inside its own Sun–Sat week.
    let week = scope_repo
        .get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();
    let day = scope_repo
        .get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let task = TaskRepository::new(&pool)
        .create(CreateTaskRequest {
            title: "Planned".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            plan_scope_id: Some(day.id),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(task.plan_scope_id, Some(day.id));
}

#[tokio::test]
async fn plan_outside_time_scope_is_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let scope_repo = ScopeRepository::new(&pool);
    let week = scope_repo
        .get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();
    // A day three weeks later is not contained in the time-scope week.
    let far_day = scope_repo
        .get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap())
        .await
        .unwrap();

    let result = TaskRepository::new(&pool)
        .create(CreateTaskRequest {
            title: "Bad plan".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            plan_scope_id: Some(far_day.id),
            ..Default::default()
        })
        .await;

    assert!(
        matches!(result, Err(arlesh_lib::tasks::error::TaskError::ScopeContainment(_))),
        "plan outside the time scope should be rejected, got {result:?}",
    );
}

// --- Cross-tree containment (child within ancestor, cascade detection, reparent) ---

fn single(scope_id: i64) -> TimeScope {
    TimeScope { start_id: scope_id, end_id: scope_id, duration: None }
}

async fn july_scopes(
    pool: &sqlx::SqlitePool,
) -> (i64, i64, i64) {
    let repo = ScopeRepository::new(pool);
    let july = repo
        .get_or_create(ScopeKind::Month, chrono::NaiveDate::from_ymd_opt(2026, 7, 15).unwrap())
        .await
        .unwrap();
    let week_in_july = repo
        .get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 15).unwrap())
        .await
        .unwrap();
    let week_in_august = repo
        .get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 8, 15).unwrap())
        .await
        .unwrap();
    (july.id, week_in_july.id, week_in_august.id)
}

#[tokio::test]
async fn child_time_scope_within_ancestor_is_accepted() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, week_in_july, _) = july_scopes(&pool).await;

    let goal = GoalRepository::new(&pool)
        .create(CreateGoalRequest {
            title: "July Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        })
        .await
        .unwrap();

    let task = TaskRepository::new(&pool)
        .create(CreateTaskRequest {
            title: "Week Task".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            time_scope: Some(single(week_in_july)),
            ..Default::default()
        })
        .await;
    assert!(task.is_ok(), "a week inside the goal's month should be accepted: {task:?}");
}

#[tokio::test]
async fn child_time_scope_outside_ancestor_is_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, _, week_in_august) = july_scopes(&pool).await;

    let goal = GoalRepository::new(&pool)
        .create(CreateGoalRequest {
            title: "July Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        })
        .await
        .unwrap();

    let result = TaskRepository::new(&pool)
        .create(CreateTaskRequest {
            title: "August Task".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            time_scope: Some(single(week_in_august)),
            ..Default::default()
        })
        .await;
    assert!(matches!(
        result,
        Err(arlesh_lib::tasks::error::TaskError::ScopeContainment(_))
    ));
}

#[tokio::test]
async fn narrowing_a_scope_reports_violating_descendants() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, week_in_july, _) = july_scopes(&pool).await;
    let goal_repo = GoalRepository::new(&pool);
    let task_repo = TaskRepository::new(&pool);

    // Goal scoped to July, with a task child also scoped to all of July.
    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "July Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        })
        .await
        .unwrap();
    let task = task_repo
        .create(CreateTaskRequest {
            title: "Whole July Task".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            time_scope: Some(single(july)),
            ..Default::default()
        })
        .await
        .unwrap();

    // Narrowing the goal to a single week would orphan the month-scoped task.
    let conflicts = task_repo
        .scope_containment_conflicts("goal", goal.id, &single(week_in_july))
        .await
        .unwrap();
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].node_type, "task");
    assert_eq!(conflicts[0].node_id, task.id);
}

#[tokio::test]
async fn reparenting_under_a_tighter_ancestor_is_rejected() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, week_in_july, week_in_august) = july_scopes(&pool).await;
    let goal_repo = GoalRepository::new(&pool);
    let task_repo = TaskRepository::new(&pool);

    let july_goal = goal_repo
        .create(CreateGoalRequest {
            title: "July Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        })
        .await
        .unwrap();
    let august_goal = goal_repo
        .create(CreateGoalRequest {
            title: "August Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(week_in_august)),
            ..Default::default()
        })
        .await
        .unwrap();
    let task = task_repo
        .create(CreateTaskRequest {
            title: "Week Task".into(),
            parent_type: "goal".into(),
            parent_id: july_goal.id,
            time_scope: Some(single(week_in_july)),
            ..Default::default()
        })
        .await
        .unwrap();

    // Moving the July-week task under the August goal must be rejected.
    let result = task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest {
                parent_type: Some("goal".into()),
                parent_id: Some(august_goal.id),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(
        result,
        Err(arlesh_lib::tasks::error::TaskError::ScopeContainment(_))
    ));
}

#[tokio::test]
async fn reparent_conflicts_flags_a_node_that_would_leave_its_new_ancestor() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, _week_in_july, week_in_august) = july_scopes(&pool).await;
    let goal_repo = GoalRepository::new(&pool);
    let task_repo = TaskRepository::new(&pool);

    let july_goal = goal_repo
        .create(CreateGoalRequest {
            title: "July".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        })
        .await
        .unwrap();
    // A task scoped to August, currently under the (unscoped) project.
    let task = task_repo
        .create(CreateTaskRequest {
            title: "August task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(week_in_august)),
            ..Default::default()
        })
        .await
        .unwrap();

    let result = task_repo
        .reparent_scope_conflicts("task", task.id, "goal", july_goal.id)
        .await
        .unwrap();

    assert!(result.ancestor_time_scope.is_some());
    assert_eq!(result.conflicts.len(), 1);
    assert_eq!(result.conflicts[0].node_type, "task");
    assert_eq!(result.conflicts[0].node_id, task.id);
}

#[tokio::test]
async fn reparent_conflicts_empty_when_node_fits_the_new_ancestor() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (july, week_in_july, _) = july_scopes(&pool).await;
    let goal_repo = GoalRepository::new(&pool);
    let task_repo = TaskRepository::new(&pool);

    let july_goal = goal_repo
        .create(CreateGoalRequest {
            title: "July".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(july)),
            ..Default::default()
        })
        .await
        .unwrap();
    let task = task_repo
        .create(CreateTaskRequest {
            title: "Fits".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(week_in_july)),
            ..Default::default()
        })
        .await
        .unwrap();

    let result = task_repo
        .reparent_scope_conflicts("task", task.id, "goal", july_goal.id)
        .await
        .unwrap();
    assert!(result.conflicts.is_empty());
}

#[tokio::test]
async fn reparent_conflicts_none_under_an_unscoped_parent() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let (_, _, week_in_august) = july_scopes(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Scoped".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(single(week_in_august)),
            ..Default::default()
        })
        .await
        .unwrap();

    let result = task_repo
        .reparent_scope_conflicts("task", task.id, "project", project_id)
        .await
        .unwrap();
    assert!(result.ancestor_time_scope.is_none());
    assert!(result.conflicts.is_empty());
}

#[tokio::test]
async fn update_rejects_plan_outside_time_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let scope_repo = ScopeRepository::new(&pool);
    let week = scope_repo
        .get_or_create(ScopeKind::Week, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();
    let far_day = scope_repo
        .get_or_create(ScopeKind::Day, chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap())
        .await
        .unwrap();
    let task_repo = TaskRepository::new(&pool);

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Scoped".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            time_scope: Some(TimeScope { start_id: week.id, end_id: week.id, duration: None }),
            ..Default::default()
        })
        .await
        .unwrap();

    let result = task_repo
        .update(
            task.id.into(),
            UpdateTaskRequest { plan_scope_id: Some(Some(far_day.id)), ..Default::default() },
        )
        .await;
    assert!(matches!(
        result,
        Err(arlesh_lib::tasks::error::TaskError::ScopeContainment(_))
    ));
}

#[tokio::test]
async fn update_goal_blocked_reason() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let goal_repo = GoalRepository::new(&pool);

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "Blockable Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let blocked = goal_repo
        .update(
            goal.id.into(),
            UpdateGoalRequest {
                blocked_reason: Some("Waiting on funding".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(blocked.blocked_reason.as_deref(), Some("Waiting on funding"));

    let cleared = goal_repo
        .update(
            goal.id.into(),
            UpdateGoalRequest { blocked_reason: Some(String::new()), ..Default::default() },
        )
        .await
        .unwrap();

    assert!(cleared.blocked_reason.is_none());
}

#[tokio::test]
async fn update_goal_scope() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let goal_repo = GoalRepository::new(&pool);

    let scope = ScopeRepository::new(&pool)
        .get_or_create(ScopeKind::Month, chrono::NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
        .await
        .unwrap();

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "Scoped Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let updated = goal_repo
        .update(
            goal.id.into(),
            UpdateGoalRequest {
                time_scope: Some(Some(TimeScope {
                    start_id: scope.id,
                    end_id: scope.id,
                    duration: None,
                })),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let time_scope = updated.time_scope.expect("time scope set");
    assert_eq!(time_scope.start_id, scope.id);
    assert_eq!(time_scope.end_id, scope.id);
}

#[tokio::test]
async fn goal_frozen_and_archived_statuses() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let goal_repo = GoalRepository::new(&pool);

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "Status Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let frozen = goal_repo
        .update(
            goal.id.into(),
            UpdateGoalRequest { status: Some(GoalStatus::Frozen), ..Default::default() },
        )
        .await
        .unwrap();
    assert_eq!(frozen.status, "frozen");

    let archived = goal_repo
        .update(
            goal.id.into(),
            UpdateGoalRequest { status: Some(GoalStatus::Archived), ..Default::default() },
        )
        .await
        .unwrap();
    assert_eq!(archived.status, "archived");
}

#[tokio::test]
async fn goal_is_achieved() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let goal_repo = GoalRepository::new(&pool);

    let goal = goal_repo
        .create(CreateGoalRequest {
            title: "Achievement Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(!goal_repo.is_achieved(goal.id.into()).await.unwrap());

    goal_repo
        .update(
            goal.id.into(),
            UpdateGoalRequest { status: Some(GoalStatus::Achieved), ..Default::default() },
        )
        .await
        .unwrap();

    assert!(goal_repo.is_achieved(goal.id.into()).await.unwrap());
}
