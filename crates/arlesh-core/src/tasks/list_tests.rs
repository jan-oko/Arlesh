//! Listing rows with their tags in one statement per table gives each row what a fetch of that
//! one row gives it.

use super::*;
use crate::database::session::SessionFactory;
use crate::database::DatabasePool;
use crate::nodes::id::tid;
use sqlx::sqlite::SqlitePoolOptions;

async fn scratch_pool() -> DatabasePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("failed to open in-memory SQLite");
    crate::database::run_migrations(&pool)
        .await
        .expect("migrations failed");
    // Rows are written directly, parents and tags included, without the rows they would name.
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&pool)
        .await
        .expect("pragma");
    pool
}

async fn insert(pool: &DatabasePool, table: &str, id: i64, parent: i64) {
    sqlx::query(&format!(
        "INSERT INTO {table} (id, title, parent_type, parent_id) VALUES (?, 'row', 'domain', ?)"
    ))
    .bind(tid(id))
    .bind(tid(parent))
    .execute(pool)
    .await
    .expect("insert");
}

async fn tag(pool: &DatabasePool, table: &str, owner: &str, row: i64, tag_id: i64) {
    sqlx::query(&format!(
        "INSERT INTO {table} ({owner}, tag_id) VALUES (?, ?)"
    ))
    .bind(tid(row))
    .bind(tid(tag_id))
    .execute(pool)
    .await
    .expect("tag");
}

#[tokio::test]
async fn listed_tasks_goals_and_expectations_carry_the_tags_a_single_fetch_gives() {
    let pool = scratch_pool().await;
    for table in ["tasks", "goals", "expectations"] {
        for row in 1..=3 {
            insert(&pool, table, row, 90).await;
        }
    }
    // Tags added out of id order, to rows out of order, one row left with none.
    for (row, tag_id) in [(2, 9), (2, 4), (1, 7), (2, 6), (1, 3)] {
        tag(&pool, "tags_on_tasks", "task_id", row, tag_id).await;
        tag(&pool, "tags_on_goals", "goal_id", row, tag_id).await;
        tag(&pool, "tags_on_expectations", "expectation_id", row, tag_id).await;
    }
    let factory = SessionFactory::new(pool);
    let mut db = factory.connect().await.expect("session");

    let tasks = db.tasks().list().await.expect("tasks");
    let goals = db.goals().list().await.expect("goals");
    let expectations = db.expectations().list().await.expect("expectations");

    assert_eq!(tasks.len(), 3);
    for task in &tasks {
        let fetched = db
            .tasks()
            .get(TaskId(task.id.stored().expect("stored")))
            .await
            .expect("get");
        assert_eq!(task.tag_ids, fetched.tag_ids);
    }
    for goal in &goals {
        let fetched = db
            .goals()
            .get(GoalId(goal.id.stored().expect("stored")))
            .await
            .expect("get");
        assert_eq!(goal.tag_ids, fetched.tag_ids);
    }
    for expectation in &expectations {
        let fetched = db
            .expectations()
            .get(ExpectationId(expectation.id.stored().expect("stored")))
            .await
            .expect("get");
        assert_eq!(expectation.tag_ids, fetched.tag_ids);
    }
    let sorted_two = tasks.iter().find(|task| task.id == tid(2)).expect("task 2");
    assert_eq!(sorted_two.tag_ids, vec![tid(4), tid(6), tid(9)]);
    let untagged = tasks.iter().find(|task| task.id == tid(3)).expect("task 3");
    assert!(untagged.tag_ids.is_empty());
}
