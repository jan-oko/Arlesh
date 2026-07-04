mod helpers;

use arlesh_lib::{
    block_reasons::BlockReasonRepository,
    domains::{
        model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
        DomainRepository,
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
            title: "Block Test Project".into(),
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
async fn list_all_returns_reasons_for_every_owner() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task = TaskRepository::new(&pool)
        .create(CreateTaskRequest { title: "T".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() })
        .await
        .unwrap();
    let goal = GoalRepository::new(&pool)
        .create(CreateGoalRequest { title: "G".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() })
        .await
        .unwrap();

    let repo = BlockReasonRepository::new(&pool);
    repo.set("task", task.id, &["a".into(), "b".into()]).await.unwrap();
    repo.set("goal", goal.id, &["x".into()]).await.unwrap();

    let all = repo.list_all().await.unwrap();
    assert_eq!(all.len(), 3);
    // Positions are 0-based per owner and preserved.
    let task_reasons: Vec<_> = all.iter().filter(|r| r.owner_type == "task").collect();
    assert_eq!(task_reasons.len(), 2);
    assert_eq!(task_reasons[0].reason, "a");
    assert_eq!(task_reasons[0].position, 0);
    assert_eq!(task_reasons[1].position, 1);
}

#[tokio::test]
async fn deleting_a_task_removes_its_block_reasons() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_repo = TaskRepository::new(&pool);
    let task = task_repo
        .create(CreateTaskRequest { title: "T".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() })
        .await
        .unwrap();
    let repo = BlockReasonRepository::new(&pool);
    repo.set("task", task.id, &["stuck".into()]).await.unwrap();

    task_repo.delete(task.id.into()).await.unwrap();

    assert!(repo.list_for("task", task.id).await.unwrap().is_empty());
    assert!(repo.list_all().await.unwrap().is_empty());
}
