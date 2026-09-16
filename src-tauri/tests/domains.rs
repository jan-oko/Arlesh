mod helpers;

use arlesh_lib::{
    commands::domains::create_domain,
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus, UpdateDomainRequest},
};
use tauri::Manager;

async fn green_aspect_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn create_project_under_aspect() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let project = db.domains()
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

    let fetched = db.domains().get(project.id.into()).await.unwrap();
    assert_eq!(fetched.id, project.id);
}

#[tokio::test]
async fn cannot_create_aspect() {
    let pool = helpers::test_pool().await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let err = db.domains()
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
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let err = db.domains().delete(aspect_id.into()).await.unwrap_err();
    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::FixedAspect),
        "expected FixedAspect, got {:?}",
        err
    );
}

#[tokio::test]
async fn tag_cannot_be_parent_of_another_tag() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let tag = db.domains()
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

    let err = db.domains()
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
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let domain = db.domains()
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

    let err = db.domains()
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
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let project = db.domains()
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

    let updated = db.domains()
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
                is_private: None,
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
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let project = db.domains()
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

    let all = db.domains().list(None).await.unwrap();
    // 6 seeded aspects + 1 created project
    assert!(all.len() >= 7);
    assert!(all.iter().any(|d| d.subtype == "aspect"));
    assert!(all.iter().any(|d| d.id == project.id));
}

#[tokio::test]
async fn list_domains_by_subtype() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let project = db.domains()
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

    db.domains().create(CreateDomainRequest {
        title: "A Domain".into(),
        description: None,
        subtype: DomainSubtype::Domain,
        parent_id: Some(aspect_id),
        status: None,
        knowledge_base_directory: None,
    })
    .await
    .unwrap();

    let projects = db.domains().list(Some(DomainSubtype::Project)).await.unwrap();
    assert!(projects.iter().all(|d| d.subtype == "project"));
    assert!(projects.iter().any(|d| d.id == project.id));
}

#[tokio::test]
async fn convert_project_subtype_to_domain() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let project = db.domains()
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

    let converted = db.domains()
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
                is_private: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(converted.subtype, "domain");
}

#[tokio::test]
async fn delete_domain() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let domain = db.domains()
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

    db.domains().delete(domain.id.into()).await.unwrap();

    let err = db.domains().get(domain.id.into()).await.unwrap_err();
    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::NotFound(_)),
        "expected NotFound, got {:?}",
        err
    );
}

#[tokio::test]
async fn cannot_update_aspect() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let err = db.domains()
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
                is_private: None,
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
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let domain = db.domains()
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

    let err = db.domains()
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
                is_private: None,
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
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let err = db.domains()
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
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let domain = db.domains()
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

    let converted = db.domains()
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
                is_private: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(converted.subtype, "project");
}

#[tokio::test]
async fn convert_domain_subtype_to_tag() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let domain = db.domains()
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

    let converted = db.domains()
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
                is_private: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(converted.subtype, "tag");
}

#[tokio::test]
async fn list_by_aspect_subtype() {
    let pool = helpers::test_pool().await;
    let aspects = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .list(Some(DomainSubtype::Aspect))
        .await
        .unwrap();

    assert_eq!(aspects.len(), 6);
    assert!(aspects.iter().all(|d| d.subtype == "aspect"));
}

#[tokio::test]
async fn project_status_achieved_and_archived() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let project = db.domains()
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

    let archived = db.domains()
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
                is_private: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(archived.status.as_deref(), Some("archived"));
}

// The tests above drive a session directly, not the command. `create_domain` writes an insert
// and then a position update, so it runs on a transactional session, and nothing but a test
// catches a command that opens `begin()` and forgets `commit()` — see `Db::commit`'s docs. The
// test below calls the real command function, with a real `tauri::State` lent by a mock app, and
// asserts row contents on disk rather than merely `Ok`.

#[tokio::test]
async fn the_create_domain_command_commits_the_insert_and_the_position_update_together() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let app = helpers::command_host(&pool);

    let project = create_domain(
        app.state(),
        CreateDomainRequest {
            title: "Committed Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        },
    )
    .await
    .unwrap();

    // The command's session is gone by now, so the pool's one connection is free to read over.
    let (title, position): (String, i64) =
        sqlx::query_as("SELECT title, position FROM domains WHERE id = ?")
            .bind(project.id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(title, "Committed Project");
    assert!(
        position > 0,
        "the command must commit the insert and the position update together, not roll them back"
    );
}

/// A Project created with no status must read back as Active, not NULL.
///
/// The app already treats an unset container status as Active (`UNSET_STATUS` in
/// `filter-tree.ts`), but a stored NULL matched no value, so List View's Project-status filter
/// silently excluded every such Project. Migration `0023` backfilled the existing rows; this is
/// what stops new ones from reintroducing them.
#[tokio::test]
async fn a_project_created_without_a_status_defaults_to_active() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let project = db
        .domains()
        .create(CreateDomainRequest {
            title: "Unset".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap();

    assert_eq!(project.status.as_deref(), Some("active"), "a new Project must default to active");
}

/// Only a Project carries a status — a Domain or Tag keeps NULL, since the status vocabulary
/// does not apply to them and defaulting one would change how the filters read it.
#[tokio::test]
async fn a_domain_created_without_a_status_keeps_none() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    for subtype in [DomainSubtype::Domain, DomainSubtype::Tag] {
        let created = db
            .domains()
            .create(CreateDomainRequest {
                title: format!("{subtype:?} unset"),
                description: None,
                subtype: subtype.clone(),
                parent_id: Some(aspect_id),
                status: None,
                knowledge_base_directory: None,
            })
            .await
            .unwrap();
        assert_eq!(created.status, None, "{subtype:?} must not be given a status");
    }
}

// --- beads_id: the link to a `bd` issue -------------------------------------------------------
//
// Settable only through the MCP server, which reaches `DomainOperator::set_beads_id` directly.
// No Tauri command writes it, and `UpdateDomainRequest` deliberately has no field for it — so
// the tests below pin both halves: the operator writes and clears it, and a command round-trip
// leaves whatever is stored exactly as it was.

#[tokio::test]
async fn set_beads_id_is_carried_by_every_domain_read() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let project = db
        .domains()
        .create(CreateDomainRequest {
            title: "Tracked Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap();
    assert_eq!(project.beads_id, None, "a new project is linked to nothing");

    db.domains()
        .set_beads_id(project.id.into(), Some("Arlesh-5fs".into()))
        .await
        .unwrap();

    assert_eq!(
        db.domains().get(project.id.into()).await.unwrap().beads_id.as_deref(),
        Some("Arlesh-5fs")
    );
    let listed = db.domains().list(Some(DomainSubtype::Project)).await.unwrap();
    assert_eq!(
        listed.iter().find(|d| d.id == project.id).unwrap().beads_id.as_deref(),
        Some("Arlesh-5fs"),
        "a list read must carry the link too, not just a by-id read"
    );
}

#[tokio::test]
async fn set_beads_id_clears_a_domain_link_when_given_none() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let project = db
        .domains()
        .create(CreateDomainRequest {
            title: "Unlinked Project".into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(aspect_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap();
    db.domains()
        .set_beads_id(project.id.into(), Some("Arlesh-5fs".into()))
        .await
        .unwrap();

    db.domains().set_beads_id(project.id.into(), None).await.unwrap();

    assert_eq!(db.domains().get(project.id.into()).await.unwrap().beads_id, None);
}

#[tokio::test]
async fn set_beads_id_rejects_an_unknown_domain() {
    let pool = helpers::test_pool().await;
    let mut db = helpers::session_factory(&pool).connect().await.unwrap();

    let err = db
        .domains()
        .set_beads_id(999_999.into(), Some("Arlesh-5fs".into()))
        .await
        .unwrap_err();

    assert!(
        matches!(err, arlesh_lib::domains::error::DomainError::NotFound(999_999)),
        "expected NotFound, got {err:?}"
    );
}

/// The write-path constraint: `update_domain` is the only command that writes a domain, and it
/// can neither set, change nor clear `beads_id`.
#[tokio::test]
async fn the_update_domain_command_cannot_touch_beads_id() {
    let pool = helpers::test_pool().await;
    let aspect_id = green_aspect_id(&pool).await;

    let (linked_id, unlinked_id) = {
        let mut db = helpers::session_factory(&pool).connect().await.unwrap();
        let linked = db
            .domains()
            .create(CreateDomainRequest {
                title: "Linked".into(),
                description: None,
                subtype: DomainSubtype::Project,
                parent_id: Some(aspect_id),
                status: Some(ProjectStatus::Active),
                knowledge_base_directory: None,
            })
            .await
            .unwrap();
        let unlinked = db
            .domains()
            .create(CreateDomainRequest {
                title: "Unlinked".into(),
                description: None,
                subtype: DomainSubtype::Project,
                parent_id: Some(aspect_id),
                status: Some(ProjectStatus::Active),
                knowledge_base_directory: None,
            })
            .await
            .unwrap();
        db.domains()
            .set_beads_id(linked.id.into(), Some("Arlesh-5fs".into()))
            .await
            .unwrap();
        (linked.id, unlinked.id)
    };

    let app = helpers::command_host(&pool);
    let updated = arlesh_lib::commands::domains::update_domain(
        app.state(),
        linked_id,
        UpdateDomainRequest {
            title: Some("Renamed".into()),
            status: Some(ProjectStatus::Frozen),
            knowledge_base_directory: Some("/vault".into()),
            is_private: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(updated.title, "Renamed", "the update itself must land");
    assert_eq!(
        updated.beads_id.as_deref(),
        Some("Arlesh-5fs"),
        "an update must neither change nor clear the beads link"
    );

    let untouched = arlesh_lib::commands::domains::update_domain(
        app.state(),
        unlinked_id,
        UpdateDomainRequest { title: Some("Also renamed".into()), ..Default::default() },
    )
    .await
    .unwrap();
    assert_eq!(untouched.beads_id, None, "and it must not be able to set one");

    let stored: Option<String> = sqlx::query_scalar("SELECT beads_id FROM domains WHERE id = ?")
        .bind(linked_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored.as_deref(), Some("Arlesh-5fs"), "and the stored row must agree");
}
