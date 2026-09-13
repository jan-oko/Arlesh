mod helpers;

use arlesh_lib::{
    block_reasons::BlockReasonRepository,
    database::session::SessionFactory,
    domains::{
        model::{CreateDomainRequest, DomainSubtype, ProjectStatus},
        DomainRepository,
    },
    tasks::{
        model::{CreateGoalRequest, CreateTaskRequest},
        GoalRepository, TaskRepository,
    },
};

async fn make_project(pool: &sqlx::SqlitePool) -> i64 {
    let aspect_id: i64 =
        sqlx::query_scalar("SELECT id FROM domains WHERE title = 'Growth' AND subtype = 'aspect'")
            .fetch_one(pool)
            .await
            .unwrap();
    DomainRepository::new(pool)
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
    let task = TaskRepository::new(&pool)
        .create(CreateTaskRequest { title: "T".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() })
        .await
        .unwrap();
    let goal = GoalRepository::new(&pool)
        .create(CreateGoalRequest { title: "G".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() })
        .await
        .unwrap();

    let repo = BlockReasonRepository::new(&pool);
    repo.set("task", task.id, &["a".into(), "b".into()]).await.unwrap();
    repo.set("goal", goal.id, &["x".into()]).await.unwrap();

    let all = repo.list_all().await.unwrap();
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
    let task_repo = TaskRepository::new(&pool);
    let task = task_repo
        .create(CreateTaskRequest { title: "T".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() })
        .await
        .unwrap();
    let repo = BlockReasonRepository::new(&pool);
    repo.set("task", task.id, &["stuck".into()]).await.unwrap();

    task_repo.delete(task.id.into()).await.unwrap();

    assert!(repo.list_for("task", task.id).await.unwrap().is_empty());
    assert!(repo.list_all().await.unwrap().is_empty());
}

/// A task to hang block reasons off, since the owner link is polymorphic and unconstrained.
async fn make_task(pool: &sqlx::SqlitePool, project_id: i64) -> i64 {
    TaskRepository::new(pool)
        .create(CreateTaskRequest { title: "T".into(), parent_type: "project".into(), parent_id: project_id, status: None, ..Default::default() })
        .await
        .unwrap()
        .id
}

/// Reads an owner's list back over a connection the session under test no longer holds.
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
