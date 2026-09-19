use crate::helpers;

use arlesh_lib::{
    commands::block_reasons::{list_all_block_reasons, set_block_reasons},
    database::session::SessionFactory,
    domains::model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
    tasks::{
        create_goal, create_task, delete_task,
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
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest { title: "T".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() },
    )
    .await
    .unwrap();
    let goal = create_goal(
        &mut db,
        CreateGoalRequest { title: "G".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() },
    )
    .await
    .unwrap();

    db.block_reasons().set("task", task.id, &["a".into(), "b".into()]).await.unwrap();
    db.block_reasons().set("goal", goal.id, &["x".into()]).await.unwrap();

    let all = db.block_reasons().list_all().await.unwrap();
    db.commit().await.unwrap();
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
    let mut db = helpers::session_factory(&pool).begin().await.unwrap();
    let task = create_task(
        &mut db,
        CreateTaskRequest { title: "T".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() },
    )
    .await
    .unwrap();
    db.block_reasons().set("task", task.id, &["stuck".into()]).await.unwrap();

    delete_task(&mut db, task.id.into()).await.unwrap();

    assert!(db.block_reasons().list_for("task", task.id).await.unwrap().is_empty());
    assert!(db.block_reasons().list_all().await.unwrap().is_empty());
    db.commit().await.unwrap();
}

/// A task to hang block reasons off, since the owner link is polymorphic and unconstrained.
async fn make_task(pool: &sqlx::SqlitePool, project_id: i64) -> i64 {
    let mut db = helpers::session_factory(pool).begin().await.unwrap();
    let id = create_task(
        &mut db,
        CreateTaskRequest { title: "T".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() },
    )
    .await
    .unwrap()
    .id;
    db.commit().await.unwrap();
    id
}

/// Reads an owner's list back over the pool, after the session under test has released it.
///
/// The test pool has **one** connection, so this is the same connection the session used, not an
/// independent observer: it distinguishes committed from rolled-back, which is what these tests
/// assert, but it could not distinguish committed from still-open. Calling it while a session is
/// alive would block on `acquire` until sqlx's 30-second timeout.
async fn reasons_on_disk(pool: &sqlx::SqlitePool, owner_id: i64) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT reason FROM block_reasons WHERE owner_type = 'task' AND owner_id = ? ORDER BY position",
    )
    .bind(owner_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

// The next two tests are a pair, and only the pair is meaningful. The first runs exactly what the
// `set_block_reasons` command runs — `begin`, `set`, `commit` — and asserts the writes landed. The
// second runs the same thing with the `commit` left out and asserts nothing landed, which is what
// makes the first one's assertion load-bearing rather than a tautology: `set` opens no transaction
// of its own, so the caller's `commit` is the only thing that can make its writes durable.

#[tokio::test]
async fn set_over_a_committed_session_replaces_the_list() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_id = make_task(&pool, project_id).await;
    let factory = SessionFactory::new(pool.clone());

    let mut db = factory.begin().await.unwrap();
    db.block_reasons()
        .set("task", task_id, &["first".into(), "second".into()])
        .await
        .unwrap();
    db.commit().await.unwrap();

    assert_eq!(
        reasons_on_disk(&pool, task_id).await,
        vec!["first".to_string(), "second".to_string()],
        "a committed session's writes must survive it"
    );

    // And that is what a later pooled session reads back, which is the `list_all_block_reasons` path.
    let mut db = factory.connect().await.unwrap();
    assert_eq!(db.block_reasons().list_for("task", task_id).await.unwrap().len(), 2);
    assert_eq!(db.block_reasons().list_all().await.unwrap().len(), 2);
}

#[tokio::test]
async fn set_over_a_session_dropped_without_commit_leaves_the_previous_list_intact() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_id = make_task(&pool, project_id).await;
    let factory = SessionFactory::new(pool.clone());

    let mut db = factory.begin().await.unwrap();
    db.block_reasons().set("task", task_id, &["original".into()]).await.unwrap();
    db.commit().await.unwrap();

    {
        let mut db = factory.begin().await.unwrap();
        db.block_reasons()
            .set("task", task_id, &["replaced".into(), "and again".into()])
            .await
            .unwrap();
        // Dropped without `commit`. `set` has already deleted the previous list and inserted the
        // new one on this connection, and both must be undone together.
    }

    assert_eq!(
        reasons_on_disk(&pool, task_id).await,
        vec!["original".to_string()],
        "an uncommitted replacement must restore the previous list, not truncate it"
    );
}

#[tokio::test]
async fn set_over_a_session_skips_blank_reasons_and_renumbers_positions() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_id = make_task(&pool, project_id).await;
    let factory = SessionFactory::new(pool.clone());

    let mut db = factory.begin().await.unwrap();
    db.block_reasons()
        .set("task", task_id, &["a".into(), "   ".into(), "b".into()])
        .await
        .unwrap();
    db.commit().await.unwrap();

    let mut db = factory.connect().await.unwrap();
    let all = db.block_reasons().list_all().await.unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].reason, "a");
    assert_eq!(all[0].position, 0);
    assert_eq!(all[1].reason, "b");
    assert_eq!(all[1].position, 1, "positions must be contiguous after a blank is skipped");
}

#[tokio::test]
async fn delete_for_over_a_session_removes_only_that_owner() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_id = make_task(&pool, project_id).await;
    let other_task_id = make_task(&pool, project_id).await;
    let factory = SessionFactory::new(pool.clone());

    let mut db = factory.begin().await.unwrap();
    db.block_reasons().set("task", task_id, &["gone".into()]).await.unwrap();
    db.block_reasons().set("task", other_task_id, &["kept".into()]).await.unwrap();
    db.block_reasons().delete_for("task", task_id).await.unwrap();
    db.commit().await.unwrap();

    assert!(reasons_on_disk(&pool, task_id).await.is_empty());
    assert_eq!(reasons_on_disk(&pool, other_task_id).await, vec!["kept".to_string()]);
}

// The two tests above exercise the session, not the command. They cannot catch the one mistake the
// session types do not prevent — a command that opens `begin()` and forgets `commit()` — because
// they are a copy of the command's body rather than the command itself. The two below call the real
// command functions, with a real `tauri::State` lent by a mock app. Delete the `db.commit()` line
// from `set_block_reasons` and the first of them fails.

#[tokio::test]
async fn the_set_block_reasons_command_commits_what_it_writes() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_id = make_task(&pool, project_id).await;
    let app = helpers::command_host(&pool);

    set_block_reasons(
        app.state(),
        "task".into(),
        task_id,
        vec!["first".into(), "second".into()],
    )
    .await
    .unwrap();

    // The command's session is gone by now, so the pool's one connection is free to read over.
    assert_eq!(
        reasons_on_disk(&pool, task_id).await,
        vec!["first".to_string(), "second".to_string()],
        "the command must commit its transaction, not roll it back on drop"
    );
}

#[tokio::test]
async fn the_set_block_reasons_command_replaces_rather_than_appends() {
    let pool = helpers::test_pool().await;
    let project_id = make_project(&pool).await;
    let task_id = make_task(&pool, project_id).await;
    let app = helpers::command_host(&pool);

    set_block_reasons(app.state(), "task".into(), task_id, vec!["original".into()])
        .await
        .unwrap();
    set_block_reasons(app.state(), "task".into(), task_id, vec!["replaced".into()])
        .await
        .unwrap();

    assert_eq!(
        reasons_on_disk(&pool, task_id).await,
        vec!["replaced".to_string()]
    );
    // And the read command sees the same thing over its own pooled session.
    let all = list_all_block_reasons(app.state()).await.unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].reason, "replaced");
}
