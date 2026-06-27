mod helpers;

use arlesh_lib::{
    knowledge_base::{
        error::KnowledgeBaseError,
        model::{CreateEventRequest, CreatePersonRequest, CreateThreadRequest, UpdatePersonRequest},
        EventRepository, PersonRepository, ThreadRepository,
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

#[tokio::test]
async fn list_people() {
    let pool = helpers::test_pool().await;
    let repo = PersonRepository::new(&pool);

    let alice = repo
        .create(CreatePersonRequest { name: "Alice".into(), aliases: None, linked_note: None })
        .await
        .unwrap();
    let bob = repo
        .create(CreatePersonRequest { name: "Bob".into(), aliases: None, linked_note: None })
        .await
        .unwrap();

    let all = repo.list().await.unwrap();
    assert!(all.iter().any(|p| p.id == alice.id));
    assert!(all.iter().any(|p| p.id == bob.id));
}

#[tokio::test]
async fn delete_person() {
    let pool = helpers::test_pool().await;
    let repo = PersonRepository::new(&pool);

    let person = repo
        .create(CreatePersonRequest { name: "Doomed".into(), aliases: None, linked_note: None })
        .await
        .unwrap();

    repo.delete(person.id.into()).await.unwrap();

    let err = repo.get(person.id.into()).await.unwrap_err();
    assert!(
        matches!(err, KnowledgeBaseError::PersonNotFound(_)),
        "expected PersonNotFound, got {:?}",
        err
    );
}

#[tokio::test]
async fn person_not_found() {
    let pool = helpers::test_pool().await;
    let err = PersonRepository::new(&pool).get(999.into()).await.unwrap_err();
    assert!(
        matches!(err, KnowledgeBaseError::PersonNotFound(999)),
        "expected PersonNotFound(999), got {:?}",
        err
    );
}

#[tokio::test]
async fn create_and_list_events() {
    let pool = helpers::test_pool().await;
    let repo = EventRepository::new(&pool);

    let e1 = repo
        .create(CreateEventRequest {
            title: "Conference".into(),
            scope_id: None,
            event_time: Some("2026-07-01T09:00:00".into()),
            linked_note: None,
        })
        .await
        .unwrap();
    let e2 = repo
        .create(CreateEventRequest {
            title: "Meeting".into(),
            scope_id: None,
            event_time: None,
            linked_note: None,
        })
        .await
        .unwrap();

    assert_eq!(e1.title, "Conference");
    assert_eq!(e2.title, "Meeting");

    let all = repo.list().await.unwrap();
    assert!(all.iter().any(|e| e.id == e1.id));
    assert!(all.iter().any(|e| e.id == e2.id));
}

#[tokio::test]
async fn delete_event() {
    let pool = helpers::test_pool().await;
    let repo = EventRepository::new(&pool);

    let event = repo
        .create(CreateEventRequest {
            title: "Doomed Event".into(),
            scope_id: None,
            event_time: None,
            linked_note: None,
        })
        .await
        .unwrap();

    repo.delete(event.id).await.unwrap();

    let all = repo.list().await.unwrap();
    assert!(!all.iter().any(|e| e.id == event.id));
}

#[tokio::test]
async fn delete_event_not_found() {
    let pool = helpers::test_pool().await;
    let err = EventRepository::new(&pool).delete(999).await.unwrap_err();
    assert!(
        matches!(err, KnowledgeBaseError::EventNotFound(999)),
        "expected EventNotFound(999), got {:?}",
        err
    );
}

#[tokio::test]
async fn create_and_list_threads() {
    let pool = helpers::test_pool().await;
    let repo = ThreadRepository::new(&pool);

    let t1 = repo
        .create(CreateThreadRequest { title: "Alpha Thread".into(), linked_note: None })
        .await
        .unwrap();
    let t2 = repo
        .create(CreateThreadRequest { title: "Beta Thread".into(), linked_note: None })
        .await
        .unwrap();

    assert_eq!(t1.title, "Alpha Thread");

    let all = repo.list().await.unwrap();
    assert!(all.iter().any(|t| t.id == t1.id));
    assert!(all.iter().any(|t| t.id == t2.id));
}

#[tokio::test]
async fn delete_thread() {
    let pool = helpers::test_pool().await;
    let repo = ThreadRepository::new(&pool);

    let thread = repo
        .create(CreateThreadRequest { title: "Doomed Thread".into(), linked_note: None })
        .await
        .unwrap();

    repo.delete(thread.id).await.unwrap();

    let all = repo.list().await.unwrap();
    assert!(!all.iter().any(|t| t.id == thread.id));
}

#[tokio::test]
async fn delete_thread_not_found() {
    let pool = helpers::test_pool().await;
    let err = ThreadRepository::new(&pool).delete(999).await.unwrap_err();
    assert!(
        matches!(err, KnowledgeBaseError::ThreadNotFound(999)),
        "expected ThreadNotFound(999), got {:?}",
        err
    );
}

#[tokio::test]
async fn update_person_linked_note() {
    let pool = helpers::test_pool().await;
    let repo = PersonRepository::new(&pool);

    let person = repo
        .create(CreatePersonRequest { name: "Dana".into(), aliases: None, linked_note: None })
        .await
        .unwrap();

    assert!(person.linked_note.is_none());

    let updated = repo
        .update(
            person.id.into(),
            UpdatePersonRequest {
                name: None,
                aliases: None,
                linked_note: Some("notes/Dana.md".into()),
            },
        )
        .await
        .unwrap();

    assert_eq!(updated.linked_note.as_deref(), Some("notes/Dana.md"));
}
