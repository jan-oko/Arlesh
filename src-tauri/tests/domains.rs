mod helpers;

use arlesh_lib::domains::{
    model::{CreateDomainRequest, DomainSubtype, ProjectStatus, UpdateDomainRequest},
    DomainRepository,
};

async fn green_aspect_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Green' AND subtype = 'aspect'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn create_project_under_aspect() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let project = repo
        .create(CreateDomainRequest {
            title: "Rust Learning".into(),
            description: Some("Learn Rust".into()),
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            kb_dir: None,
        })
        .await
        .unwrap();

    assert_eq!(project.title, "Rust Learning");
    assert_eq!(project.subtype, "project");
    assert_eq!(project.parent_id, Some(aspect_id));

    let fetched = repo.get(project.id.into()).await.unwrap();
    assert_eq!(fetched.id, project.id);
}

#[tokio::test]
async fn cannot_create_aspect() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);

    let err = repo
        .create(CreateDomainRequest {
            title: "New Aspect".into(),
            description: None,
            subtype: DomainSubtype::Aspect,
            parent_id: None,
            status: None,
            kb_dir: None,
        })
        .await
        .unwrap_err();

    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::FixedAspect),
        "expected FixedAspect, got {:?}",
        err
    );
}

#[tokio::test]
async fn cannot_delete_aspect() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let err = repo.delete(aspect_id.into()).await.unwrap_err();
    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::FixedAspect),
        "expected FixedAspect, got {:?}",
        err
    );
}

#[tokio::test]
async fn tag_cannot_be_parent_of_another_tag() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let tag = repo
        .create(CreateDomainRequest {
            title: "rust".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(aspect_id),
            status: None,
            kb_dir: None,
        })
        .await
        .unwrap();

    let err = repo
        .create(CreateDomainRequest {
            title: "child-tag".into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(tag.id),
            status: None,
            kb_dir: None,
        })
        .await
        .unwrap_err();

    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::TagCannotHaveChildren),
        "expected TagCannotHaveChildren, got {:?}",
        err
    );
}

#[tokio::test]
async fn project_requires_aspect_or_project_parent() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let domain = repo
        .create(CreateDomainRequest {
            title: "General".into(),
            description: None,
            subtype: DomainSubtype::Domain,
            parent_id: Some(aspect_id),
            status: None,
            kb_dir: None,
        })
        .await
        .unwrap();

    let err = repo
        .create(CreateDomainRequest {
            title: "Bad Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(domain.id),
            status: None,
            kb_dir: None,
        })
        .await
        .unwrap_err();

    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::InvalidParent(_)),
        "expected InvalidParent, got {:?}",
        err
    );
}

#[tokio::test]
async fn update_domain() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let project = repo
        .create(CreateDomainRequest {
            title: "Old Title".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            kb_dir: None,
        })
        .await
        .unwrap();

    let updated = repo
        .update(
            project.id.into(),
            UpdateDomainRequest {
                title: Some("New Title".into()),
                description: None,
                parent_id: None,
                status: Some(ProjectStatus::Frozen),
                kb_dir: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(updated.title, "New Title");
    assert_eq!(updated.status.as_deref(), Some("frozen"));
}
