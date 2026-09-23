use crate::helpers;

use arlesh_lib::{
    database::session::SessionFactory,
    knowledge_base::{
        error::KnowledgeBaseError,
        model::{
            CreateEventRequest, CreatePersonRequest, CreateThreadRequest, UpdatePersonRequest,
        },
    },
    tasks::{create_task, model::CreateTaskRequest, update_task},
};

async fn make_project_id(pool: &sqlx::SqlitePool) -> i64 {
    use arlesh_lib::domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus};
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
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
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();

    let person = db
        .people()
        .create(CreatePersonRequest {
            name: "Alice".into(),
            aliases: Some(vec!["Al".into()]),
            linked_note: None,
        })
        .await
        .unwrap();

    assert_eq!(person.name, "Alice");
    assert!(person.aliases.contains("Al"));

    let fetched = db.people().get(person.id.into()).await.unwrap();
    assert_eq!(fetched.name, person.name);
}

#[tokio::test]
async fn update_person_aliases() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();

    let person = db
        .people()
        .create(CreatePersonRequest {
            name: "Bob".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap();

    let updated = db
        .people()
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

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let person = db
        .people()
        .create(CreatePersonRequest {
            name: "Carol".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap();
    drop(db); // release the pool's one connection before the next session claims it

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Delegated Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    update_task(
        &mut db,
        task.id.into(),
        arlesh_lib::tasks::model::UpdateTaskRequest {
            delegate_to: Some(Some(arlesh_lib::tasks::model::Delegate::Person {
                id: person.id,
            })),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let fetched = db.tasks().get(task.id.into()).await.unwrap();
    assert_eq!(
        fetched.delegate_to,
        Some(arlesh_lib::tasks::model::Delegate::Person { id: person.id })
    );

    // `Some(None)` is what an explicit `null` on the wire now decodes to, and it has to reach the
    // column: undelegating a task must remove the link rather than leave the old person on it.
    update_task(
        &mut db,
        task.id.into(),
        arlesh_lib::tasks::model::UpdateTaskRequest {
            delegate_to: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let undelegated = db.tasks().get(task.id.into()).await.unwrap();
    db.commit().await.unwrap();
    assert_eq!(
        undelegated.delegate_to, None,
        "clearing the delegate must remove it"
    );
}

#[tokio::test]
async fn list_people() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();

    let alice = db
        .people()
        .create(CreatePersonRequest {
            name: "Alice".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap();
    let bob = db
        .people()
        .create(CreatePersonRequest {
            name: "Bob".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap();

    let all = db.people().list().await.unwrap();
    assert!(all.iter().any(|p| p.id == alice.id));
    assert!(all.iter().any(|p| p.id == bob.id));
}

#[tokio::test]
async fn delete_person() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();

    let person = db
        .people()
        .create(CreatePersonRequest {
            name: "Doomed".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap();

    db.people().delete(person.id.into()).await.unwrap();

    let err = db.people().get(person.id.into()).await.unwrap_err();
    assert!(
        matches!(err, KnowledgeBaseError::PersonNotFound(_)),
        "expected PersonNotFound, got {:?}",
        err
    );
}

#[tokio::test]
async fn person_not_found() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let err = db.people().get(999.into()).await.unwrap_err();
    assert!(
        matches!(err, KnowledgeBaseError::PersonNotFound(999)),
        "expected PersonNotFound(999), got {:?}",
        err
    );
}

#[tokio::test]
async fn create_and_list_events() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();

    let e1 = db
        .events()
        .create(CreateEventRequest {
            title: "Conference".into(),
            scope_id: None,
            event_time: Some("2026-07-01T09:00:00".into()),
            linked_note: None,
        })
        .await
        .unwrap();
    let e2 = db
        .events()
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

    let all = db.events().list().await.unwrap();
    assert!(all.iter().any(|e| e.id == e1.id));
    assert!(all.iter().any(|e| e.id == e2.id));
}

#[tokio::test]
async fn delete_event() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();

    let event = db
        .events()
        .create(CreateEventRequest {
            title: "Doomed Event".into(),
            scope_id: None,
            event_time: None,
            linked_note: None,
        })
        .await
        .unwrap();

    db.events().delete(event.id).await.unwrap();

    let all = db.events().list().await.unwrap();
    assert!(!all.iter().any(|e| e.id == event.id));
}

#[tokio::test]
async fn delete_event_not_found() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let err = db.events().delete(999).await.unwrap_err();
    assert!(
        matches!(err, KnowledgeBaseError::EventNotFound(999)),
        "expected EventNotFound(999), got {:?}",
        err
    );
}

#[tokio::test]
async fn create_and_list_threads() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();

    let t1 = db
        .threads()
        .create(CreateThreadRequest {
            title: "Alpha Thread".into(),
            linked_note: None,
        })
        .await
        .unwrap();
    let t2 = db
        .threads()
        .create(CreateThreadRequest {
            title: "Beta Thread".into(),
            linked_note: None,
        })
        .await
        .unwrap();

    assert_eq!(t1.title, "Alpha Thread");

    let all = db.threads().list().await.unwrap();
    assert!(all.iter().any(|t| t.id == t1.id));
    assert!(all.iter().any(|t| t.id == t2.id));
}

#[tokio::test]
async fn delete_thread() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();

    let thread = db
        .threads()
        .create(CreateThreadRequest {
            title: "Doomed Thread".into(),
            linked_note: None,
        })
        .await
        .unwrap();

    db.threads().delete(thread.id).await.unwrap();

    let all = db.threads().list().await.unwrap();
    assert!(!all.iter().any(|t| t.id == thread.id));
}

#[tokio::test]
async fn delete_thread_not_found() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let err = db.threads().delete(999).await.unwrap_err();
    assert!(
        matches!(err, KnowledgeBaseError::ThreadNotFound(999)),
        "expected ThreadNotFound(999), got {:?}",
        err
    );
}

#[tokio::test]
async fn update_person_linked_note() {
    let pool = helpers::test_pool().await;
    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();

    let person = db
        .people()
        .create(CreatePersonRequest {
            name: "Dana".into(),
            aliases: None,
            linked_note: None,
        })
        .await
        .unwrap();

    assert!(person.linked_note.is_none());

    let updated = db
        .people()
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
