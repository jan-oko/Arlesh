use crate::helpers;

use arlesh_lib::{
    commands::infos::update_info,
    database::session::SessionFactory,
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    infos::model::{CreateInfoRequest, UpdateInfoRequest},
    tasks::{
        create_goal, create_task,
        model::{CreateGoalRequest, CreateTaskRequest},
    },
};
use tauri::Manager;

async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
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

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest {
            title: "A Goal".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Important detail".into(),
            details: None,
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

    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "A Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Task note".into(),
            details: None,
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
    let domain = helpers::session_factory(&pool)
        .connect()
        .await
        .unwrap()
        .domains()
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

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Domain note".into(),
            details: None,
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

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let parent_info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Parent note".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();

    let child_info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Child note".into(),
            details: None,
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

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let a = db
        .infos()
        .create(CreateInfoRequest {
            body: "Alpha".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();
    let b = db
        .infos()
        .create(CreateInfoRequest {
            body: "Beta".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project_id,
            position: 1,
        })
        .await
        .unwrap();

    let all = db.infos().list().await.unwrap();
    assert!(all.iter().any(|i| i.id == a.id));
    assert!(all.iter().any(|i| i.id == b.id));
}

#[tokio::test]
async fn update_info_body() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Old text".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();

    let updated = db
        .infos()
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

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Note".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project_id,
            position: 5,
        })
        .await
        .unwrap();

    let updated = db
        .infos()
        .update(info.id.into(), UpdateInfoRequest { position: Some(10), ..Default::default() })
        .await
        .unwrap();

    assert_eq!(updated.position, 10);
}

#[tokio::test]
async fn update_info_private_round_trips() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Note".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();
    assert!(!info.is_private); // defaults to not-private

    let marked = db
        .infos()
        .update(info.id.into(), UpdateInfoRequest { is_private: Some(true), ..Default::default() })
        .await
        .unwrap();
    assert!(marked.is_private);
    assert_eq!(marked.body, "Note"); // body untouched

    let cleared = db
        .infos()
        .update(info.id.into(), UpdateInfoRequest { is_private: Some(false), ..Default::default() })
        .await
        .unwrap();
    assert!(!cleared.is_private);
}

#[tokio::test]
async fn update_info_parent() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest {
            title: "Target Task".into(),
            parent_type: "project".into(),
            parent_id: project_id,
            status: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db.commit().await.unwrap();

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Reparented note".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();

    let updated = db
        .infos()
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

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Temporary note".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();

    db.infos().delete(info.id.into()).await.unwrap();

    let all = db.infos().list().await.unwrap();
    assert!(!all.iter().any(|i| i.id == info.id));
}

#[tokio::test]
async fn details_round_trip_set_and_clear() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Crash".into(),
            details: Some("stack trace line 1\nline 2".into()),
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();
    assert_eq!(info.details.as_deref(), Some("stack trace line 1\nline 2"));

    // Update the details.
    let updated = db
        .infos()
        .update(info.id.into(), UpdateInfoRequest { details: Some(Some("new trace".into())), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(updated.details.as_deref(), Some("new trace"));
    assert_eq!(updated.body, "Crash"); // body untouched

    // Clear the details.
    let cleared = db
        .infos()
        .update(info.id.into(), UpdateInfoRequest { details: Some(None), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(cleared.details, None);
}

// The tests above exercise the session directly, not the command. `update_info` can write up to
// five statements (one per field the request touches), so it runs on a transactional session, and
// nothing but a test catches a command that opens `begin()` and forgets `commit()` — see
// `Db::commit`'s docs. The test below calls the real command function, with a real `tauri::State`
// lent by a mock app, and asserts row contents on disk rather than merely `Ok`.

#[tokio::test]
async fn the_update_info_command_commits_every_field_it_touches() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;

    let factory = SessionFactory::new(pool.clone());
    let mut db = factory.connect().await.unwrap();
    let info = db
        .infos()
        .create(CreateInfoRequest {
            body: "Before".into(),
            details: None,
            parent_type: "project".into(),
            parent_id: project_id,
            position: 0,
        })
        .await
        .unwrap();
    drop(db); // release the pool's one connection before the command claims it

    let app = helpers::command_host(&pool);
    update_info(
        app.state(),
        info.id,
        UpdateInfoRequest {
            body: Some("After".into()),
            position: Some(9),
            is_private: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // The command's session is gone by now, so the pool's one connection is free to read over.
    let (body, position, is_private): (String, i64, bool) =
        sqlx::query_as("SELECT body, position, is_private FROM infos WHERE id = ?")
            .bind(info.id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(body, "After");
    assert_eq!(position, 9);
    assert!(
        is_private,
        "the command must commit every field it touched, not roll them back"
    );
}
