mod helpers;

use arlesh_lib::domains::{
    model::{CreateDomainRequest, DomainSubtype, ProjectStatus, UpdateDomainRequest},
    DomainRepository,
};

async fn green_aspect_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
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
            knowledge_base_directory: None,
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
            knowledge_base_directory: None,
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
            knowledge_base_directory: None,
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
            knowledge_base_directory: None,
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
            knowledge_base_directory: None,
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
            knowledge_base_directory: None,
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
            knowledge_base_directory: None,
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
                subtype: None,
                status: Some(ProjectStatus::Frozen),
                knowledge_base_directory: None,
                position: None,
                nsfw: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(updated.title, "New Title");
    assert_eq!(updated.status.as_deref(), Some("frozen"));
}

#[tokio::test]
async fn list_all_domains_includes_aspects_and_created() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let project = repo
        .create(CreateDomainRequest {
            title: "Listed Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    let all = repo.list(None).await.unwrap();
    // 6 seeded aspects + 1 created project
    assert!(all.len() >= 7);
    assert!(all.iter().any(|d| d.subtype == "aspect"));
    assert!(all.iter().any(|d| d.id == project.id));
}

#[tokio::test]
async fn list_domains_by_subtype() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let project = repo
        .create(CreateDomainRequest {
            title: "Only Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    repo.create(CreateDomainRequest {
        title: "A Domain".into(),
        description: None,
        subtype: DomainSubtype::Domain,
        parent_id: Some(aspect_id),
        status: None,
        knowledge_base_directory: None,
    })
    .await
    .unwrap();

    let projects = repo.list(Some(DomainSubtype::Project)).await.unwrap();
    assert!(projects.iter().all(|d| d.subtype == "project"));
    assert!(projects.iter().any(|d| d.id == project.id));
}

#[tokio::test]
async fn convert_project_subtype_to_domain() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let project = repo
        .create(CreateDomainRequest {
            title: "Becoming Domain".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    assert_eq!(project.subtype, "project");

    let converted = repo
        .update(
            project.id.into(),
            UpdateDomainRequest {
                title: None,
                description: None,
                parent_id: None,
                subtype: Some(DomainSubtype::Domain),
                status: None,
                knowledge_base_directory: None,
                position: None,
                nsfw: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(converted.subtype, "domain");
}

#[tokio::test]
async fn delete_domain() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let domain = repo
        .create(CreateDomainRequest {
            title: "Doomed Domain".into(),
            description: None,
            subtype: DomainSubtype::Domain,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    repo.delete(domain.id.into()).await.unwrap();

    let err = repo.get(domain.id.into()).await.unwrap_err();
    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::NotFound(_)),
        "expected NotFound, got {:?}",
        err
    );
}

#[tokio::test]
async fn cannot_update_aspect() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let err = repo
        .update(
            aspect_id.into(),
            UpdateDomainRequest {
                title: Some("Hacked Aspect".into()),
                description: None,
                parent_id: None,
                subtype: None,
                status: None,
                knowledge_base_directory: None,
                position: None,
                nsfw: None,
            },
        )
        .await
        .unwrap_err();

    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::FixedAspect),
        "expected FixedAspect, got {:?}",
        err
    );
}

#[tokio::test]
async fn cannot_change_subtype_to_aspect() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let domain = repo
        .create(CreateDomainRequest {
            title: "Aspiring Domain".into(),
            description: None,
            subtype: DomainSubtype::Domain,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    let err = repo
        .update(
            domain.id.into(),
            UpdateDomainRequest {
                subtype: Some(DomainSubtype::Aspect),
                title: None,
                description: None,
                parent_id: None,
                status: None,
                knowledge_base_directory: None,
                position: None,
                nsfw: None,
            },
        )
        .await
        .unwrap_err();

    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::FixedAspect),
        "expected FixedAspect, got {:?}",
        err
    );
}

#[tokio::test]
async fn project_without_parent_is_rejected() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);

    let err = repo
        .create(CreateDomainRequest {
            title: "Parentless Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: None,
            status: None,
            knowledge_base_directory: None,
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
async fn convert_domain_subtype_to_project() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let domain = repo
        .create(CreateDomainRequest {
            title: "Will Become Project".into(),
            description: None,
            subtype: DomainSubtype::Domain,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    let converted = repo
        .update(
            domain.id.into(),
            UpdateDomainRequest {
                subtype: Some(DomainSubtype::Project),
                parent_id: Some(aspect_id),
                title: None,
                description: None,
                status: None,
                knowledge_base_directory: None,
                position: None,
                nsfw: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(converted.subtype, "project");
}

#[tokio::test]
async fn convert_domain_subtype_to_tag() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let domain = repo
        .create(CreateDomainRequest {
            title: "Will Become Tag".into(),
            description: None,
            subtype: DomainSubtype::Domain,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    let converted = repo
        .update(
            domain.id.into(),
            UpdateDomainRequest {
                subtype: Some(DomainSubtype::Tag),
                title: None,
                description: None,
                parent_id: None,
                status: None,
                knowledge_base_directory: None,
                position: None,
                nsfw: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(converted.subtype, "tag");
}

#[tokio::test]
async fn list_by_aspect_subtype() {
    let pool = helpers::test_pool().await;
    let aspects = DomainRepository::new(&pool)
        .list(Some(DomainSubtype::Aspect))
        .await
        .unwrap();

    assert_eq!(aspects.len(), 6);
    assert!(aspects.iter().all(|d| d.subtype == "aspect"));
}

#[tokio::test]
async fn project_status_achieved_and_archived() {
    let pool = helpers::test_pool().await;
    let repo = DomainRepository::new(&pool);
    let aspect_id = green_aspect_id(&pool).await;

    let project = repo
        .create(CreateDomainRequest {
            title: "Status Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Achieved),
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    assert_eq!(project.status.as_deref(), Some("achieved"));

    let archived = repo
        .update(
            project.id.into(),
            UpdateDomainRequest {
                status: Some(ProjectStatus::Archived),
                title: None,
                description: None,
                parent_id: None,
                subtype: None,
                knowledge_base_directory: None,
                position: None,
                nsfw: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(archived.status.as_deref(), Some("archived"));
}
