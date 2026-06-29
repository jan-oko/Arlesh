mod helpers;

use arlesh_lib::{
    domains::{
        model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
        DomainRepository,
    },
    infos::{
        model::{CreateInfoRequest, UpdateInfoRequest},
        InfoRepository,
    },
    tasks::{
        model::{CreateGoalRequest, CreateTaskRequest},
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
            title: "Info Test Project".into(),
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

#[tokio::test]
async fn create_info_under_goal() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let goal = GoalRepository::new(&pool)
        .create(CreateGoalRequest {
            title: "A Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let info = InfoRepository::new(&pool)
        .create(CreateInfoRequest {
            body: "Important detail".into(),
            parent_type: "goal".into(),
            parent_id: goal.id,
            position: 0,
        })
        .await
        .unwrap();

    assert_eq!(info.body, "Important detail");
    assert_eq!(info.parent_type, "goal");
    assert_eq!(info.parent_id, goal.id);
}

#[tokio::test]
async fn create_info_under_task() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let task = TaskRepository::new(&pool)
        .create(CreateTaskRequest {
            title: "A Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let info = InfoRepository::new(&pool)
        .create(CreateInfoRequest {
            body: "Task note".into(),
            parent_type: "task".into(),
            parent_id: task.id,
            position: 0,
        })
        .await
        .unwrap();

    assert_eq!(info.parent_type, "task");
    assert_eq!(info.parent_id, task.id);
}

#[tokio::test]
async fn create_info_under_domain() {
    let pool = helpers::test_pool().await;
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let domain = DomainRepository::new(&pool)
        .create(CreateDomainRequest {
            title: "My Domain".into(),
            description: None,
            subtype: DomainSubtype::Domain,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    let info = InfoRepository::new(&pool)
        .create(CreateInfoRequest {
            body: "Domain note".into(),
            parent_type: "domain".into(),
            parent_id: domain.id,
            position: 0,
        })
        .await
        .unwrap();

    assert_eq!(info.parent_type, "domain");
    assert_eq!(info.parent_id, domain.id);
}

#[tokio::test]
async fn create_nested_info_under_info() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let repo = InfoRepository::new(&pool);
    let parent_info = repo
        .create(CreateInfoRequest {
            body: "Parent note".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();

    let child_info = repo
        .create(CreateInfoRequest {
            body: "Child note".into(),
            parent_type: "info".into(),
            parent_id: parent_info.id,
            position: 0,
        })
        .await
        .unwrap();

    assert_eq!(child_info.parent_type, "info");
    assert_eq!(child_info.parent_id, parent_info.id);
}

#[tokio::test]
async fn list_infos_returns_all() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let repo = InfoRepository::new(&pool);
    let a = repo
        .create(CreateInfoRequest {
            body: "Alpha".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();
    let b = repo
        .create(CreateInfoRequest {
            body: "Beta".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            position: 1,
        })
        .await
        .unwrap();

    let all = repo.list().await.unwrap();
    assert!(all.iter().any(|i| i.id == a.id));
    assert!(all.iter().any(|i| i.id == b.id));
}

#[tokio::test]
async fn update_info_body() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let repo = InfoRepository::new(&pool);
    let info = repo
        .create(CreateInfoRequest {
            body: "Old text".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();

    let updated = repo
        .update(info.id.into(), UpdateInfoRequest { body: Some("New text".into()), ..Default::default() })
        .await
        .unwrap();

    assert_eq!(updated.body, "New text");
    assert_eq!(updated.parent_id, project_id);
}

#[tokio::test]
async fn update_info_position() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let repo = InfoRepository::new(&pool);
    let info = repo
        .create(CreateInfoRequest {
            body: "Note".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            position: 5,
        })
        .await
        .unwrap();

    let updated = repo
        .update(info.id.into(), UpdateInfoRequest { position: Some(10), ..Default::default() })
        .await
        .unwrap();

    assert_eq!(updated.position, 10);
}

#[tokio::test]
async fn update_info_parent() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = TaskRepository::new(&pool)
        .create(CreateTaskRequest {
            title: "Target Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        })
        .await
        .unwrap();

    let repo = InfoRepository::new(&pool);
    let info = repo
        .create(CreateInfoRequest {
            body: "Reparented note".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();

    let updated = repo
        .update(
            info.id.into(),
            UpdateInfoRequest {
                parent_type: Some("task".into()),
                parent_id: Some(task.id),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(updated.parent_type, "task");
    assert_eq!(updated.parent_id, task.id);
}

#[tokio::test]
async fn delete_info() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let repo = InfoRepository::new(&pool);
    let info = repo
        .create(CreateInfoRequest {
            body: "Temporary note".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();

    repo.delete(info.id.into()).await.unwrap();

    let all = repo.list().await.unwrap();
    assert!(!all.iter().any(|i| i.id == info.id));
}
