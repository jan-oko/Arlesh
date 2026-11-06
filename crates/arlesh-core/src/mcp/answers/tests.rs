//! The answers a host that speaks the protocol itself gives, against a migrated scratch database.

use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{json, Value};

use super::ArleshMcp;
use crate::database::open::{open, OpenMode};

static NEXT: AtomicU32 = AtomicU32::new(0);

async fn handler() -> (ArleshMcp, std::path::PathBuf) {
    let directory = std::env::temp_dir().join(format!(
        "arlesh-answers-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let factory = open(
        &directory.join("arlesh.db"),
        OpenMode::Write {
            client: "answers-test".parse().unwrap(),
            force: false,
        },
    )
    .await
    .unwrap();
    (ArleshMcp::new(factory), directory)
}

#[tokio::test]
async fn an_unknown_tool_is_a_protocol_error() {
    let (mcp, directory) = handler().await;

    let answer = mcp.answer_call("arlesh_missing", Value::Null, None).await;

    assert_eq!(answer["error"]["code"], -32602, "{answer}");
    assert_eq!(answer["error"]["message"], "tool not found");
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn a_tool_that_refuses_is_a_result_flagged_as_an_error() {
    let (mcp, directory) = handler().await;

    let answer = mcp
        .answer_call(
            "arlesh_tasks",
            json!({ "operation": "get", "id": "999999" }),
            None,
        )
        .await;

    assert_eq!(answer["result"]["isError"], true, "{answer}");
    assert!(answer["result"]["structuredContent"]["kind"].is_string());
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn parameters_of_the_wrong_shape_are_a_result_flagged_as_an_error() {
    let (mcp, directory) = handler().await;

    let answer = mcp
        .answer_call("arlesh_tasks", json!({ "operation": 7 }), None)
        .await;

    assert_eq!(answer["result"]["isError"], true, "{answer}");
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn arguments_that_are_not_an_object_are_invalid_params() {
    let (mcp, directory) = handler().await;

    let answer = mcp.answer_call("arlesh_snapshot", json!([1]), None).await;

    assert_eq!(answer["error"]["code"], -32602, "{answer}");
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn a_second_call_reuses_the_idle_connection() {
    let (mcp, directory) = handler().await;

    let first = mcp.answer_call("arlesh_capacity", json!({}), None).await;
    let second = mcp.answer_call("arlesh_capacity", json!({}), None).await;

    assert!(first.get("result").is_some() && second.get("result").is_some());
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn initialize_carries_the_instructions_and_the_negotiated_version() {
    let (mcp, directory) = handler().await;
    let params = json!({
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": { "name": "test", "version": "0" },
    });

    let answer = mcp.answer_initialize(params).await;

    assert_eq!(
        answer["result"]["protocolVersion"], "2025-03-26",
        "{answer}"
    );
    assert!(answer["result"]["instructions"]
        .as_str()
        .is_some_and(|text| text.contains("arlesh_snapshot") && text.contains("MCP ROOTS")));
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn initialize_params_that_are_not_a_handshake_are_invalid() {
    let (mcp, directory) = handler().await;

    let answer = mcp.answer_initialize(json!({ "nope": 1 })).await;

    assert_eq!(answer["error"]["code"], -32602, "{answer}");
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn result_type_is_sent_only_to_a_client_new_enough_to_expect_it() {
    let (mcp, directory) = handler().await;
    let call = |version: Option<&'static str>| {
        let mcp = mcp.clone();
        async move { mcp.answer_call("arlesh_capacity", json!({}), version).await }
    };

    let legacy = call(Some("2025-03-26")).await;
    let unnamed = call(None).await;
    let current = call(Some("2026-07-28")).await;

    assert!(legacy["result"].get("resultType").is_none(), "{legacy}");
    assert!(unnamed["result"].get("resultType").is_none(), "{unnamed}");
    assert_eq!(current["result"]["resultType"], "complete", "{current}");
    let _ = std::fs::remove_dir_all(directory);
}
