mod helpers;

use arlesh_lib::{
    domains::{
        model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
        DomainRepository,
    },
    tasks::{
        model::{
            CreateGoalRequest, CreateTaskRequest, Dependency, GoalStatus, UpdateGoalRequest,
            UpdateTaskRequest,
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
            scope_id: None,
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
            scope_id: None,
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
            scope_id: None,
        })
        .await
        .unwrap();

    let task_b = task_repo
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
            scope_id: None,
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
            scope_id: None,
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
            scope_id: None,
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
            scope_id: None,
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
            scope_id: None,
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
            scope_id: None,
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
            scope_id: None,
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
            scope_id: None,
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
            scope_id: None,
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
            scope_id: None,
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
