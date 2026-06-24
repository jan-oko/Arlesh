mod helpers;

use arlesh_lib::{
    knowledge_base::{
        model::{CreatePersonRequest, UpdatePersonRequest},
        PersonRepository,
    },
    tasks::{
        model::CreateTaskRequest,
        TaskRepository,
    },
};

async fn make_project_id(pool: &sqlx::SqlitePool) -> i64 {
    use arlesh_lib::domains::{
        model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
        DomainRepository,
    };
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    DomainRepository::new(pool)
        .create(CreateDomainRequest {
            title: "Knowledge Base Test Project".into(),
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
async fn create_and_fetch_person() {
    let pool = helpers::test_pool().await;
    let repo = PersonRepository::new(&pool);

    let person = repo
        .create(CreatePersonRequest {
            name: "Alice".into(),
            aliases: Some(vec!["Al".into()]),
            linked_note: None,
        })
        .await
        .unwrap();

    assert_eq!(person.name, "Alice");
    assert!(person.aliases.contains("Al"));

    let fetched = repo.get(person.id.into()).await.unwrap();
    assert_eq!(fetched.name, person.name);
}

#[tokio::test]
async fn update_person_aliases() {
    let pool = helpers::test_pool().await;
    let repo = PersonRepository::new(&pool);

    let person = repo
        .create(CreatePersonRequest {
            name: "Bob".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap();

    let updated = repo
        .update(
            person.id.into(),
            UpdatePersonRequest {
                name: None,
                aliases: Some(vec!["Bobby".into(), "Robert".into()]),
                linked_note: None,
            },
        )
        .await
        .unwrap();

    assert!(updated.aliases.contains("Bobby"));
}

#[tokio::test]
async fn person_linked_to_task_via_delegation() {
    let pool = helpers::test_pool().await;
    let project_id = make_project_id(&pool).await;

    let person = PersonRepository::new(&pool)
        .create(CreatePersonRequest {
            name: "Carol".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap();

    let task_repo = TaskRepository::new(&pool);
    let task = task_repo
        .create(CreateTaskRequest {
            title: "Delegated Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            scope_id: None,
        })
        .await
        .unwrap();

    task_repo
        .update(
            task.id.into(),
            arlesh_lib::tasks::model::UpdateTaskRequest {
                delegate_to: Some(Some(person.id)),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let fetched = task_repo.get(task.id.into()).await.unwrap();
    assert_eq!(fetched.delegate_to, Some(person.id));
}
