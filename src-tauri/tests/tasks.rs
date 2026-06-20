mod helpers;

use arlesh_lib::{
    domains::{
        model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
        DomainRepository,
    },
    tasks::{
        model::{CreateGoalRequest, CreateTaskRequest, Dependency, GoalStatus, UpdateGoalRequest, UpdateTaskRequest},
        GoalRepository, TaskRepository,
    },
};

async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Green' AND subtype = 'aspect'")
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
            kb_dir: None,
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
            scope_id: None,
        })
        .await
        .unwrap();

    assert_eq!(task.title, "Write tests");
    assert_eq!(task.status, "todo");

    let goal = GoalRepository::new(&pool)
        .create(CreateGoalRequest {
            title: "Ship Phase 1".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            scope_id: None,
        })
        .await
        .unwrap();

    assert_eq!(goal.status, "active");
}

#[tokio::test]
async fn undone_dependency_blocks_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);

    let dep = task_repo
        .create(CreateTaskRequest {
            title: "Dependency".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            scope_id: None,
        })
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Blocked Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            scope_id: None,
        })
        .await
        .unwrap();

    task_repo
        .add_dependency(task.id.into(), Dependency::Task { id: dep.id })
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

    let dep = task_repo
        .create(CreateTaskRequest {
            title: "Dep".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            scope_id: None,
        })
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            scope_id: None,
        })
        .await
        .unwrap();

    task_repo
        .add_dependency(task.id.into(), Dependency::Task { id: dep.id })
        .await
        .unwrap();

    task_repo
        .update(
            dep.id.into(),
            UpdateTaskRequest {
                title: None,
                status: Some(arlesh_lib::tasks::model::TaskStatus::Done),
                blocked_reason: None,
                delegate_to: None,
                scope_id: None,
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

    let a = task_repo
        .create(CreateTaskRequest {
            title: "A".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            scope_id: None,
        })
        .await
        .unwrap();

    let b = task_repo
        .create(CreateTaskRequest {
            title: "B".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            scope_id: None,
        })
        .await
        .unwrap();

    task_repo
        .add_dependency(a.id.into(), Dependency::Task { id: b.id })
        .await
        .unwrap();

    let err = task_repo
        .add_dependency(b.id.into(), Dependency::Task { id: a.id })
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
            scope_id: None,
        })
        .await
        .unwrap();

    let task = task_repo
        .create(CreateTaskRequest {
            title: "Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            scope_id: None,
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
                title: None,
                status: Some(GoalStatus::Achieved),
                blocked_reason: None,
                scope_id: None,
            },
        )
        .await
        .unwrap();

    let unblocked = task_repo.get_with_blockers(task.id.into()).await.unwrap();
    assert!(unblocked.block_reasons.is_empty());
}
