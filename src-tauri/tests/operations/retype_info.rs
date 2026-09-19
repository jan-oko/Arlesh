//! Integration tests for the info side of `tasks::retype`: the sixth `RetypeKind`, added so that
//! an info retype runs through the same atomic, field-aware machinery every other kind already
//! had, instead of the frontend's old bespoke create/reparent/delete sequence.
//!
//! Each test earns its place against one of the three consequences the old frontend path had:
//! silent field loss, no atomicity, and a mislabelled polymorphic `parent_type`.

use crate::helpers;

use arlesh_lib::{
    commands::retype::retype_node,
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    infos::model::{CreateInfoRequest, InfoId, UpdateInfoRequest},
    tasks::retype::{apply_retype, plan_node_retype, RetypeKind, StrandedChildren},
};
use tauri::Manager;

async fn aspect_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn make_project(pool: &sqlx::SqlitePool, parent_id: i64, title: &str) -> i64 {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: title.into(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(parent_id),
            status: Some(ProjectStatus::Active),
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

async fn make_domain(pool: &sqlx::SqlitePool, parent_id: i64, title: &str) -> i64 {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: title.into(),
            description: None,
            subtype: DomainSubtype::Domain,
            parent_id: Some(parent_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

async fn make_tag(pool: &sqlx::SqlitePool, parent_id: i64, title: &str) -> i64 {
    helpers::session_factory(pool)
        .connect()
        .await
        .unwrap()
        .domains()
        .create(CreateDomainRequest {
            title: title.into(),
            description: None,
            subtype: DomainSubtype::Tag,
            parent_id: Some(parent_id),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

#[allow(clippy::too_many_arguments)]
async fn make_info(
    pool: &sqlx::SqlitePool,
    parent_type: &str,
    parent_id: i64,
    body: &str,
    details: Option<&str>,
    is_private: bool,
    position: i64,
) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: body.into(),
            details: details.map(String::from),
            parent_type: parent_type.into(),
            parent_id,
            position,
        })
        .await
        .unwrap();
    if is_private {
        db.infos()
            .update(
                InfoId(info.id),
                UpdateInfoRequest { is_private: Some(true), ..Default::default() },
            )
            .await
            .unwrap();
    }
    db.commit().await.unwrap();
    info.id
}

/// Plans and applies a retype on its own transactional session, committing on success — the same
/// shape `commands::retype::retype_node` uses, minus the wire-error translation, for the tests
/// that only need the domain-level result.
async fn retype_committed(
    pool: &sqlx::SqlitePool,
    from: RetypeKind,
    id: i64,
    to: RetypeKind,
    stranded: StrandedChildren,
) -> arlesh_lib::tasks::retype::RetypedNode {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let planned = plan_node_retype(&mut db, from, id, to).await.unwrap();
    let retyped = apply_retype(&mut db, &planned, stranded).await.unwrap();
    db.commit().await.unwrap();
    retyped
}

// --- consequence #1: silent field loss ---

#[tokio::test]
async fn retyping_a_private_info_to_a_task_keeps_it_private() {
    let pool = helpers::test_pool().await;
    let aspect = aspect_id(&pool).await;
    let project = make_project(&pool, aspect, "Ops").await;
    let info_id = make_info(&pool, "project", project, "Secret note", None, true, 0).await;

    let retyped =
        retype_committed(&pool, RetypeKind::Info, info_id, RetypeKind::Task, StrandedChildren::Reparent).await;

    let is_private: bool = sqlx::query_scalar("SELECT is_private FROM tasks WHERE id = ?")
        .bind(retyped.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(is_private, "privacy must carry from an info to the task it becomes");
}

#[tokio::test]
async fn retyping_an_info_to_a_project_carries_its_details_into_the_description() {
    let pool = helpers::test_pool().await;
    let aspect = aspect_id(&pool).await;
    let info_id = make_info(&pool, "aspect", aspect, "Reading list", Some("Long-form notes"), false, 0).await;

    let retyped =
        retype_committed(&pool, RetypeKind::Info, info_id, RetypeKind::Project, StrandedChildren::Reparent).await;

    let description: Option<String> = sqlx::query_scalar("SELECT description FROM domains WHERE id = ?")
        .bind(retyped.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        description.as_deref(),
        Some("Long-form notes"),
        "Info.details and Domain.description are the same domain concept — see SPEC"
    );
}

// --- consequence #3: the mislabelled polymorphic parent_type ---

#[tokio::test]
async fn retyping_an_info_nested_under_an_info_to_a_goal_climbs_to_the_project_and_never_points_at_the_info() {
    let pool = helpers::test_pool().await;
    let aspect = aspect_id(&pool).await;
    let project = make_project(&pool, aspect, "Ops").await;
    let outer_info = make_info(&pool, "project", project, "Parent note", None, false, 0).await;
    let inner_info = make_info(&pool, "info", outer_info, "Child note", None, false, 0).await;

    let app = helpers::command_host(&pool);

    // First call: no acknowledgement yet, so the command must refuse and name the climb —
    // the corruption this whole design exists to prevent must never happen silently.
    let refused = retype_node(app.state(), "info".into(), inner_info, "goal".into(), None)
        .await
        .expect_err("a goal cannot hang under an info, so the command must ask before climbing");

    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(wire["kind"], serde_json::json!("needs_confirmation"));
    assert_eq!(
        wire["details"]["parent_climb"],
        serde_json::json!({
            "from": { "kind": "info", "id": outer_info, "title": "Parent note" },
            "to": { "kind": "project", "id": project, "title": "Ops" },
        }),
        "the prompt must say the retype moves the node out from under the info to the project"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM goals")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0,
        "the refusal must write nothing"
    );

    // Second call: the caller has seen the prompt and confirmed.
    let retyped = retype_node(
        app.state(),
        "info".into(),
        inner_info,
        "goal".into(),
        Some(StrandedChildren::Reparent),
    )
    .await
    .expect("confirmed, so the climb is now carried out");

    let (parent_type, parent_id): (String, i64) =
        sqlx::query_as("SELECT parent_type, parent_id FROM goals WHERE id = ?")
            .bind(retyped.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        parent_type, "project",
        "the collapsed spelling for a domains-table parent — never the info's own kind"
    );
    assert_eq!(
        parent_id, project,
        "must point at the project's row, not at the info the node used to sit under"
    );
}

// --- consequence #2: no atomicity ---

/// Forces a genuine mid-transaction failure — deleting a stranded domain that still has a child
/// of its own trips the real `domains.parent_id` foreign key — and proves nothing from the
/// operation leaked out: no duplicate info row, and the note that *did* get reparented during the
/// same transaction is back under the original project once the session rolls back.
///
/// This is not vacuous in the way the brief warns about: `create_node`'s insert and
/// `adopt_children`'s reparent both genuinely execute, on the one shared connection, before the
/// later delete fails — so this only passes if the whole sequence is truly one transaction that
/// rolls back as a unit, not because nothing happened yet when the error surfaced. Confirmed by
/// hand: temporarily calling `db.commit()` before propagating the delete's error made this test
/// fail exactly as expected (the note stayed reparented, the duplicate info row stayed present).
#[tokio::test]
async fn a_stranded_childs_delete_failing_rolls_back_the_whole_retype() {
    let pool = helpers::test_pool().await;
    let aspect = aspect_id(&pool).await;
    let project = make_project(&pool, aspect, "Doomed Project").await;
    let nested_domain = make_domain(&pool, project, "Nested Domain").await;
    let _grandchild_tag = make_tag(&pool, nested_domain, "Grandchild Tag").await;
    let note = make_info(&pool, "project", project, "Sticky note", None, false, 0).await;

    let app = helpers::command_host(&pool);
    let result = retype_node(
        app.state(),
        "project".into(),
        project,
        "info".into(),
        Some(StrandedChildren::Delete),
    )
    .await;

    assert!(
        result.is_err(),
        "the nested domain still has a child of its own, so deleting it must fail"
    );

    let new_info_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM infos WHERE body = 'Doomed Project'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(new_info_count, 0, "create_node's insert must have rolled back — no duplicate node");

    let (note_parent_type, note_parent_id): (String, i64) =
        sqlx::query_as("SELECT parent_type, parent_id FROM infos WHERE id = ?")
            .bind(note)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (note_parent_type.as_str(), note_parent_id),
        ("project", project),
        "the note must not be left half-moved onto a node that was never actually created"
    );

    let project_row_survives: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM domains WHERE id = ? AND subtype = 'project'")
            .bind(project)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(project_row_survives, 1, "the source row must survive the rollback");

    let nested_domain_survives: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM domains WHERE id = ? AND parent_id = ?")
            .bind(nested_domain)
            .bind(project)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nested_domain_survives, 1, "the stranded domain must not have been half-deleted");
}
