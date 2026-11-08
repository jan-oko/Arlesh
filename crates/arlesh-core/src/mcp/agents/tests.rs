//! The attach gate, end to end through the handler an endpoint serves: what an unattached session
//! may call, what an attached one sees, and how two agents share a board.

use serde_json::{json, Value};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

use super::*;
use crate::{agents::service::issue_pin, database::session::SessionFactory, mcp::session::Binding};

async fn board() -> (ArleshMcp, SqlitePool) {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::database::run_migrations(&pool).await.unwrap();
    for sql in [
        "INSERT INTO domains (id, title, subtype) VALUES (901, 'Growth', 'aspect')",
        "INSERT INTO domains (id, title, subtype, parent_id, status) VALUES (902, 'Arlesh', 'project', 901, 'active')",
        "INSERT INTO goals (id, title, parent_type, parent_id, status) VALUES (10, 'Ship', 'domain', 902, 'active')",
        "INSERT INTO goals (id, title, parent_type, parent_id, status) VALUES (11, 'Launch', 'domain', 902, 'active')",
        "INSERT INTO tasks (id, title, parent_type, parent_id, status, agentic) VALUES (100, 'Docs', 'goal', 10, 'agentic_todo', 1)",
        "INSERT INTO tasks (id, title, parent_type, parent_id, status, agentic) VALUES (101, 'Announce', 'goal', 11, 'agentic_todo', 1)",
        "INSERT INTO mcp_roots (node_kind, node_id) VALUES ('domain', 901)",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    let mcp = ArleshMcp::new(SessionFactory::new(pool.clone())).requiring_attachment();
    (mcp, pool)
}

fn session(mcp: &ArleshMcp) -> ArleshMcp {
    mcp.clone().for_session(Binding::default())
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

async fn pin(mcp: &ArleshMcp) -> String {
    let mut db = mcp.factory.begin().await.unwrap();
    let issued = issue_pin(&mut db, mcp.now()).await.unwrap();
    db.commit().await.unwrap();
    issued.pin
}

async fn attach(mcp: &ArleshMcp, name: &str, goal: i64) -> Value {
    let pin = pin(mcp).await;
    call(
        mcp,
        "arlesh_agents",
        json!({
            "operation": "attach",
            "pin": pin,
            "session_id": format!("session-{name}"),
            "name": name,
            "account": "work",
            "subtree": { "node_type": "goal", "node_id": goal.to_string() },
        }),
    )
    .await
}

#[tokio::test]
async fn an_unattached_session_may_call_nothing_but_the_attach_tool() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);

    for (tool, arguments) in [
        ("arlesh_tasks", json!({ "operation": "get", "id": "100" })),
        ("arlesh_snapshot", json!({ "operation": "load" })),
        (
            "arlesh_scopes",
            json!({ "operation": "get", "id": { "kind": "day", "date": "2026-11-07" } }),
        ),
        ("arlesh_capacity", json!({ "operation": "get" })),
        ("arlesh_kb", json!({ "operation": "list_people" })),
        ("arlesh_agents", json!({ "operation": "status" })),
    ] {
        let answer = call(&session, tool, arguments).await;

        assert!(is_error(&answer), "{tool}: {answer}");
        assert_eq!(structured(&answer)["kind"], "not_permitted", "{tool}");
    }
}

#[tokio::test]
async fn the_in_process_handler_needs_no_attach() {
    let (mcp, _pool) = board().await;
    let in_process = ArleshMcp::new(mcp.factory.clone());

    let answer = call(
        &in_process,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;

    assert!(!is_error(&answer), "{answer}");
}

#[tokio::test]
async fn a_wrong_pin_attaches_nothing() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);

    let answer = call(
        &session,
        "arlesh_agents",
        json!({ "operation": "attach", "pin": "00000000", "session_id": "s" }),
    )
    .await;

    assert!(is_error(&answer), "{answer}");
    let still = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;
    assert!(is_error(&still));
}

#[tokio::test]
async fn attaching_binds_the_session_and_its_view_is_the_claim() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);

    let attached = attach(&session, "writer", 10).await;

    assert!(!is_error(&attached), "{attached}");
    assert!(structured(&attached)["token"].is_string(), "{attached}");
    assert_eq!(structured(&attached)["standing"], "active");
    let inside = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;
    assert!(!is_error(&inside), "{inside}");
    let outside = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "101" }),
    )
    .await;
    assert!(is_error(&outside), "{outside}");
    assert_eq!(structured(&outside)["kind"], "not_permitted");
}

#[tokio::test]
async fn reads_outside_the_claim_are_omitted_from_the_snapshot() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach(&session, "writer", 10).await;

    let answer = call(
        &session,
        "arlesh_snapshot",
        json!({ "operation": "load", "sections": ["tasks"] }),
    )
    .await;

    let titles: Vec<&str> = structured(&answer)["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|task| task["title"].as_str())
        .collect();
    assert_eq!(titles, ["Docs"], "{answer}");
}

#[tokio::test]
async fn an_agent_writes_inside_its_claim_and_not_outside_it() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach(&session, "writer", 10).await;

    let inside = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "create", "parent_type": "goal", "parent_id": "10", "title": "New" }),
    )
    .await;
    let outside = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "create", "parent_type": "goal", "parent_id": "11", "title": "Nope" }),
    )
    .await;

    assert!(!is_error(&inside), "{inside}");
    assert!(is_error(&outside), "{outside}");
    let created = structured(&inside)["id"].clone();
    let again = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": created.to_string().trim_matches('"') }),
    )
    .await;
    assert!(
        !is_error(&again),
        "an agent still sees the task it created: {again}"
    );
}

#[tokio::test]
async fn a_second_agent_claiming_an_overlapping_subtree_is_refused_naming_the_first() {
    let (mcp, _pool) = board().await;
    let first = session(&mcp);
    let second = session(&mcp);
    attach(&first, "writer", 10).await;

    let attached = attach(&second, "reviewer", 10).await;

    assert!(
        !is_error(&attached),
        "the attach itself goes through: {attached}"
    );
    assert!(
        structured(&attached)["claim_refused"]
            .as_str()
            .unwrap()
            .contains("writer"),
        "{attached}"
    );
    let seen = call(
        &second,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;
    assert!(is_error(&seen), "it holds nothing, so it sees nothing");
}

#[tokio::test]
async fn pausing_lets_another_agent_claim_and_resuming_is_refused_until_it_lets_go() {
    let (mcp, _pool) = board().await;
    let first = session(&mcp);
    let second = session(&mcp);
    attach(&first, "writer", 10).await;
    attach(&second, "reviewer", 11).await;

    call(&first, "arlesh_agents", json!({ "operation": "pause" })).await;
    let taken = call(
        &second,
        "arlesh_agents",
        json!({ "operation": "claim", "subtree": { "node_type": "goal", "node_id": "10" } }),
    )
    .await;
    let resumed = call(&first, "arlesh_agents", json!({ "operation": "resume" })).await;

    assert!(!is_error(&taken), "{taken}");
    assert!(is_error(&resumed), "{resumed}");
    call(&second, "arlesh_agents", json!({ "operation": "release" })).await;
    let again = call(&first, "arlesh_agents", json!({ "operation": "resume" })).await;
    assert!(!is_error(&again), "{again}");
}

#[tokio::test]
async fn a_paused_agent_reads_and_writes_nothing() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach(&session, "writer", 10).await;
    call(&session, "arlesh_agents", json!({ "operation": "pause" })).await;

    let read = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;
    let write = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "update", "id": "100", "title": "Renamed" }),
    )
    .await;

    assert!(!is_error(&read), "{read}");
    assert!(is_error(&write), "{write}");
}

#[tokio::test]
async fn a_new_session_re_attaches_with_the_token_after_the_old_one_is_lost() {
    let (mcp, _pool) = board().await;
    let first = session(&mcp);
    let attached = attach(&first, "writer", 10).await;
    let token = structured(&attached)["token"].as_str().unwrap().to_owned();

    let after_restart = session(&mcp);
    let denied = call(
        &after_restart,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;
    let back = call(
        &after_restart,
        "arlesh_agents",
        json!({ "operation": "attach", "token": token, "session_id": "resumed" }),
    )
    .await;

    assert!(is_error(&denied));
    assert!(!is_error(&back), "{back}");
    assert_eq!(structured(&back)["agent"]["name"], "writer");
    assert_eq!(
        structured(&back)["standing"],
        "active",
        "the claim outlives the session"
    );
    let seen = call(
        &after_restart,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;
    assert!(!is_error(&seen), "{seen}");
}

#[tokio::test]
async fn an_agent_removed_by_hand_is_turned_away_at_its_next_call() {
    let (mcp, pool) = board().await;
    let session = session(&mcp);
    attach(&session, "writer", 10).await;

    sqlx::query("DELETE FROM agents")
        .execute(&pool)
        .await
        .unwrap();

    let answer = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;
    assert!(is_error(&answer), "{answer}");
}

#[tokio::test]
async fn the_agent_that_hits_its_limit_has_its_claimed_tasks_blocked_and_others_not() {
    let (mcp, _pool) = board().await;
    let working = session(&mcp);
    let idle = session(&mcp);
    attach(&working, "writer", 10).await;
    let pin = pin(&mcp).await;
    call(
        &idle,
        "arlesh_agents",
        json!({
            "operation": "attach", "pin": pin, "session_id": "idle", "name": "other",
            "account": "home",
            "subtree": { "node_type": "goal", "node_id": "11" },
        }),
    )
    .await;

    let resets = (mcp.now() + chrono::Duration::hours(3))
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string();
    let reported = call(
        &working,
        "arlesh_agents",
        json!({ "operation": "report_usage", "windows": [{ "kind": "five_hour", "percent_used": 100, "resets_at": resets }] }),
    )
    .await;

    assert!(!is_error(&reported), "{reported}");
    let blocked = call(
        &working,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;
    let free = call(
        &idle,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "101" }),
    )
    .await;
    let reasons = |answer: &Value| structured(answer)["block_reasons"].to_string();
    assert!(
        reasons(&blocked).contains("Agents at capacity"),
        "{blocked}"
    );
    assert!(!reasons(&free).contains("Agents at capacity"), "{free}");
}

#[tokio::test]
async fn an_unattached_session_is_told_how_to_attach_and_an_attached_one_what_it_holds() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);

    assert!(session.instructions().await.contains("NOT ATTACHED"));

    attach(&session, "writer", 10).await;
    let text = session.instructions().await;
    assert!(text.contains("YOU ARE AGENT"), "{text}");
    assert!(text.contains("Ship"), "{text}");
    assert!(
        !text.contains("Launch"),
        "it names its claim, not the user's roots: {text}"
    );
}

#[tokio::test]
async fn the_attach_tool_is_listed_with_every_operation() {
    let (mcp, _pool) = board().await;

    let tool = mcp
        .tools()
        .into_iter()
        .find(|tool| tool.name == "arlesh_agents")
        .unwrap();

    let schema = serde_json::to_string(&*tool.input_schema).unwrap();
    for operation in [
        "attach",
        "status",
        "claim",
        "pause",
        "resume",
        "release",
        "report_usage",
    ] {
        assert!(schema.contains(operation), "{operation}");
    }
}

fn streams() -> crate::mcp::events::EventStreams {
    crate::mcp::events::EventStreams::default()
}

async fn poll(
    mcp: &ArleshMcp,
    streams: &crate::mcp::events::EventStreams,
    agent: Option<crate::agents::model::AgentId>,
    after: Option<u64>,
    epoch: Option<String>,
) -> Value {
    let query = crate::mcp::events::ExpectationsQuery {
        agentic: true,
        after,
        epoch,
        wait: Some(0),
        agent,
    };
    let text = crate::mcp::events::poll_answer(&mcp.factory, streams, &query)
        .await
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

#[tokio::test]
async fn the_wait_stream_tells_an_agent_only_of_waits_inside_its_claim() {
    let (mcp, _pool) = board().await;
    let writer = session(&mcp);
    let reviewer = session(&mcp);
    let first = attach(&writer, "writer", 10).await;
    let second = attach(&reviewer, "reviewer", 11).await;
    let id = |attached: &Value| {
        crate::agents::model::AgentId(structured(attached)["agent"]["id"].as_i64().unwrap())
    };
    let streams = streams();
    // A cursor of 0 is no cursor: the log starts counting at the first write.
    streams.feed.bump();
    let start = poll(&mcp, &streams, Some(id(&first)), None, None).await;
    let (revision, epoch) = (
        start["revision"].as_u64().unwrap(),
        start["epoch"].as_str().unwrap().to_owned(),
    );

    let asked = call(
        &writer,
        "arlesh_waits",
        json!({ "operation": "ask", "task_id": "100", "title": "Which colour?" }),
    )
    .await;
    assert!(!is_error(&asked), "{asked}");
    streams.feed.bump();

    let mine = poll(
        &mcp,
        &streams,
        Some(id(&first)),
        Some(revision),
        Some(epoch.clone()),
    )
    .await;
    let theirs = poll(
        &mcp,
        &streams,
        Some(id(&second)),
        Some(revision),
        Some(epoch),
    )
    .await;

    assert_eq!(mine["changes"].as_array().unwrap().len(), 1, "{mine}");
    assert_eq!(theirs["changes"].as_array().unwrap().len(), 0, "{theirs}");
}

#[tokio::test]
async fn an_agent_with_no_claim_is_told_of_no_waits() {
    let (mcp, _pool) = board().await;
    let writer = session(&mcp);
    let idle = session(&mcp);
    attach(&writer, "writer", 10).await;
    let pin = pin(&mcp).await;
    let attached = call(
        &idle,
        "arlesh_agents",
        json!({ "operation": "attach", "pin": pin, "session_id": "idle" }),
    )
    .await;
    let idle_id =
        crate::agents::model::AgentId(structured(&attached)["agent"]["id"].as_i64().unwrap());
    let streams = streams();
    // A cursor of 0 is no cursor: the log starts counting at the first write.
    streams.feed.bump();
    let start = poll(&mcp, &streams, Some(idle_id), None, None).await;
    let (revision, epoch) = (
        start["revision"].as_u64().unwrap(),
        start["epoch"].as_str().unwrap().to_owned(),
    );
    call(
        &writer,
        "arlesh_waits",
        json!({ "operation": "ask", "task_id": "100", "title": "Q" }),
    )
    .await;
    streams.feed.bump();

    let heard = poll(&mcp, &streams, Some(idle_id), Some(revision), Some(epoch)).await;

    assert_eq!(heard["changes"].as_array().unwrap().len(), 0, "{heard}");
}

#[tokio::test]
async fn claiming_an_id_that_does_not_name_a_visible_node_is_refused_one_way() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach(&session, "writer", 10).await;

    let missing = call(
        &session,
        "arlesh_agents",
        json!({ "operation": "claim", "subtree": { "node_type": "goal", "node_id": "999" } }),
    )
    .await;
    let wrong_kind = call(
        &session,
        "arlesh_agents",
        json!({ "operation": "claim", "subtree": { "node_type": "task", "node_id": "10" } }),
    )
    .await;

    assert!(is_error(&missing) && is_error(&wrong_kind));
    assert_eq!(structured(&missing)["kind"], "not_permitted");
    assert_eq!(structured(&wrong_kind)["kind"], "not_permitted");
}
