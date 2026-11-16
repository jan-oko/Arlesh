//! A To Do Task with an open agent question reads Review, over the handler an endpoint serves.

use crate::nodes::id::tid;
use serde_json::{json, Value};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

use crate::{database::session::SessionFactory, mcp::ArleshMcp};

async fn board() -> (ArleshMcp, SqlitePool) {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::database::run_migrations(&pool).await.unwrap();
    for sql in [
        "INSERT INTO domains (id, title, subtype) VALUES ('00000000-0000-7000-8000-000000000385', 'Growth', 'aspect')",
        "INSERT INTO domains (id, title, subtype, parent_id, status) VALUES ('00000000-0000-7000-8000-000000000386', 'Arlesh', 'project', '00000000-0000-7000-8000-000000000385', 'active')",
        "INSERT INTO goals (id, title, parent_type, parent_id, status) VALUES ('00000000-0000-7000-8000-00000000000a', 'Ship', 'domain', '00000000-0000-7000-8000-000000000386', 'active')",
        "INSERT INTO tasks (id, title, parent_type, parent_id, status, agentic) VALUES ('00000000-0000-7000-8000-000000000064', 'Docs', 'goal', '00000000-0000-7000-8000-00000000000a', 'agentic_todo', 1)",
        "INSERT INTO mcp_roots (node_kind, node_id) VALUES ('domain', '00000000-0000-7000-8000-000000000385')",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    (ArleshMcp::new(SessionFactory::new(pool.clone())), pool)
}

async fn call(mcp: &ArleshMcp, tool: &str, arguments: Value) -> Value {
    mcp.answer_call(tool, arguments, None).await
}

fn is_error(answer: &Value) -> bool {
    answer["result"]["isError"] == true
}

fn structured(answer: &Value) -> &Value {
    &answer["result"]["structuredContent"]
}

/// The status the board shows for task 100 (a snapshot read: the board derives Review).
async fn shown(mcp: &ArleshMcp) -> String {
    let answer = call(
        mcp,
        "arlesh_snapshot",
        json!({ "operation": "load", "agentic": {}, "sections": ["tasks"] }),
    )
    .await;
    let tasks = structured(&answer)["tasks"].as_array().unwrap().clone();
    let task = tasks.iter().find(|task| task["id"] == tid(100).to_string()).unwrap();
    task["status"]["status"]
        .as_str()
        .unwrap_or_else(|| panic!("{task}"))
        .to_string()
}

async fn stored(pool: &SqlitePool) -> String {
    sqlx::query_scalar("SELECT status FROM tasks WHERE id = '00000000-0000-7000-8000-000000000064'")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn ask(mcp: &ArleshMcp, question: bool) -> String {
    let answer = call(
        mcp,
        "arlesh_waits",
        json!({ "operation": "raise", "task_id": tid(100).to_string(), "title": "Which?", "question": question }),
    )
    .await;
    assert!(!is_error(&answer), "{answer}");
    structured(&answer)["id"].as_str().unwrap().to_string()
}

async fn give_spec(mcp: &ArleshMcp) {
    let answer = call(
        mcp,
        "arlesh_tasks",
        json!({ "operation": "update", "id": tid(100).to_string(), "brief": { "spec": "Do it" } }),
    )
    .await;
    assert!(!is_error(&answer), "{answer}");
}

async fn set_status(mcp: &ArleshMcp, expected: &str, status: &str) -> Value {
    call(
        mcp,
        "arlesh_tasks",
        json!({ "operation": "set_status", "id": tid(100).to_string(), "expected": expected, "status": status }),
    )
    .await
}

#[tokio::test]
async fn a_question_under_a_to_do_task_puts_it_in_review_and_the_answer_returns_it() {
    let (mcp, pool) = board().await;
    assert_eq!(shown(&mcp).await, "todo");

    let wait = ask(&mcp, true).await;
    assert_eq!(shown(&mcp).await, "review");
    assert_eq!(stored(&pool).await, "agentic_todo");

    let released = call(
        &mcp,
        "arlesh_waits",
        json!({ "operation": "release", "id": wait, "answer": "Blue" }),
    )
    .await;
    assert!(!is_error(&released), "{released}");
    assert_eq!(shown(&mcp).await, "todo");
}

#[tokio::test]
async fn a_wait_that_is_not_a_question_leaves_a_to_do_task_to_do() {
    let (mcp, _pool) = board().await;
    ask(&mcp, false).await;
    assert_eq!(shown(&mcp).await, "todo");
}

#[tokio::test]
async fn set_status_compares_against_review_for_such_a_task_and_not_against_todo() {
    let (mcp, _pool) = board().await;
    ask(&mcp, true).await;

    let wrong = set_status(&mcp, "todo", "on_agent").await;
    assert!(is_error(&wrong), "{wrong}");
    assert_eq!(structured(&wrong)["kind"], "status_changed", "{wrong}");
}

#[tokio::test]
async fn claiming_a_to_do_task_with_an_open_question_works_and_it_stays_review() {
    let (mcp, pool) = board().await;
    give_spec(&mcp).await;
    ask(&mcp, true).await;

    let claimed = set_status(&mcp, "review", "on_agent").await;

    assert!(!is_error(&claimed), "{claimed}");
    assert_eq!(stored(&pool).await, "on_agent");
    assert_eq!(shown(&mcp).await, "review");
}

#[tokio::test]
async fn an_on_agent_task_reading_review_cannot_be_claimed_again() {
    let (mcp, _pool) = board().await;
    give_spec(&mcp).await;
    set_status(&mcp, "todo", "on_agent").await;
    ask(&mcp, true).await;

    let again = set_status(&mcp, "review", "on_agent").await;

    assert!(is_error(&again), "{again}");
}

#[tokio::test]
async fn a_review_is_refused_under_a_to_do_task_even_while_a_question_is_open() {
    let (mcp, _pool) = board().await;
    ask(&mcp, true).await;

    let review = call(
        &mcp,
        "arlesh_waits",
        json!({ "operation": "raise_review", "task_id": tid(100).to_string(), "title": "Done", "summary": "It is" }),
    )
    .await;

    assert!(is_error(&review), "{review}");
}
