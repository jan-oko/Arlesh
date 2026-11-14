use super::*;
use crate::access::model::NodeTable;
use crate::database::open::{open, OpenMode};
use crate::flows::model::{CreateFlowItemRequest, CreateFlowRequest, InstanceType};
use crate::infos::model::CreateInfoRequest;
use crate::scopes::key::test_key;
use crate::tasks::model::TimeScope;
use crate::tasks::model::{
    CreateCommitmentRequest, CreateExpectationRequest, CreateGoalRequest, CreateTaskRequest,
};
use std::sync::atomic::{AtomicU32, Ordering};

/// Distinguishes the scratch directories of tests running concurrently in one process.
static NEXT_DIRECTORY: AtomicU32 = AtomicU32::new(0);

async fn session() -> (crate::database::session::SessionFactory, Db<Transactional>) {
    let directory = std::env::temp_dir().join(format!(
        "arlesh-duplicate-test-{}-{}",
        std::process::id(),
        NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let factory = open(
        &directory.join("arlesh.db"),
        OpenMode::Write {
            client: "test".parse().unwrap(),
            force: false,
        },
    )
    .await
    .unwrap();
    let db = factory.begin().await.unwrap();
    (factory, db)
}

async fn project_under(db: &mut Db<Transactional>, title: &str, parent: i64) -> i64 {
    db.domains()
        .create(CreateDomainRequest {
            title: title.to_string(),
            description: None,
            subtype: DomainSubtype::Project,
            parent_id: Some(parent),
            status: None,
            knowledge_base_directory: None,
        })
        .await
        .unwrap()
        .id
}

async fn project(db: &mut Db<Transactional>, title: &str, parent: i64) -> i64 {
    project_under(db, title, parent).await
}

/// Fills a Project with one of everything it can hold.
async fn fill(db: &mut Db<Transactional>, project: i64) {
    let goal = crate::tasks::create_goal(
        db,
        CreateGoalRequest {
            title: "Goal".into(),
            parent_type: "project".into(),
            parent_id: project.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let task = |title: &str, parent_type: &str, parent_id: i64| CreateTaskRequest {
        title: title.into(),
        parent_type: parent_type.into(),
        parent_id: parent_id.into(),
        ..Default::default()
    };
    let first = crate::tasks::create_task(db, task("First", "goal", goal.id.stored().unwrap()))
        .await
        .unwrap();
    let second = crate::tasks::create_task(db, task("Second", "project", project))
        .await
        .unwrap();
    crate::tasks::create_commitment(
        db,
        CreateCommitmentRequest {
            title: "Commitment".into(),
            parent_type: "task".into(),
            parent_id: first.id.clone(),
            time_scope: Some(TimeScope {
                start_id: test_key(1000),
                end_id: test_key(1000),
                duration: None,
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    crate::tasks::expectations::create_expectation(
        db,
        CreateExpectationRequest {
            title: "Wait".into(),
            parent_type: "task".into(),
            parent_id: second.id.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.infos()
        .create(CreateInfoRequest {
            body: "Info".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project.into(),
            position: 0,
        })
        .await
        .unwrap();
    project_under(db, "Sub-project", project).await;
    let flow = db
        .flows()
        .create(CreateFlowRequest {
            title: "Flow".into(),
            instance_type: Some(InstanceType::Task),
            parent_type: "project".into(),
            parent_id: project,
            ..Default::default()
        })
        .await
        .unwrap();
    db.flows()
        .create_task(CreateFlowItemRequest {
            flow_id: flow.id,
            title: "Step".into(),
            parent_type: "flow".into(),
            parent_id: flow.id,
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn a_duplicated_project_with_content_is_deleted_like_any_other() {
    let (_factory, mut db) = session().await;
    let original = project(&mut db, "Original", 1).await;
    fill(&mut db, original).await;
    let copy = duplicate_subtree(&mut db, DuplicableKind::Domain, original, "", 1, 5)
        .await
        .unwrap()
        .root_id;

    crate::domains::delete_subtree(&mut db, DomainId(copy))
        .await
        .unwrap();

    assert_nothing_left_under(&mut db, copy).await;
    // The original and its content are untouched.
    assert!(db.domains().get(DomainId(original)).await.is_ok());
    assert!(!db
        .tasks()
        .child_ids("project", original)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn a_project_with_content_is_deleted_without_having_been_duplicated() {
    let (_factory, mut db) = session().await;
    let original = project(&mut db, "Original", 1).await;
    fill(&mut db, original).await;

    crate::domains::delete_subtree(&mut db, DomainId(original))
        .await
        .unwrap();

    assert_nothing_left_under(&mut db, original).await;
}

#[tokio::test]
async fn an_aspect_is_refused_and_nothing_is_deleted() {
    let (_factory, mut db) = session().await;
    assert!(crate::domains::delete_subtree(&mut db, DomainId(1))
        .await
        .is_err());
    assert!(db.domains().get(DomainId(1)).await.is_ok());
}

/// The Project, its sub-Project and every kind of content that hung under it are gone.
async fn assert_nothing_left_under(db: &mut Db<Transactional>, project: i64) {
    assert!(db.domains().get(DomainId(project)).await.is_err());
    assert!(db
        .domains()
        .child_ids(DomainId(project))
        .await
        .unwrap()
        .is_empty());
    assert!(db
        .tasks()
        .child_ids("project", project)
        .await
        .unwrap()
        .is_empty());
    assert!(db
        .goals()
        .child_ids("project", project)
        .await
        .unwrap()
        .is_empty());
    assert!(db
        .infos()
        .child_ids("project", project)
        .await
        .unwrap()
        .is_empty());
    assert!(db
        .flows()
        .ids_under(NodeTable::Domain, project)
        .await
        .unwrap()
        .is_empty());
}
