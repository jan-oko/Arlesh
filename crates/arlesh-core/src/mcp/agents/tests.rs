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

#[tokio::test]
async fn an_agent_locks_itself_and_its_claimed_tasks_read_blocked_until_it_unlocks() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach(&session, "writer", 10).await;
    let blocked = |answer: &Value| structured(answer)["block_reasons"].to_string();

    let locked = call(&session, "arlesh_agents", json!({ "operation": "lock" })).await;
    let held = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;
    call(&session, "arlesh_agents", json!({ "operation": "unlock" })).await;
    let freed = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;

    assert!(!is_error(&locked), "{locked}");
    assert_eq!(structured(&locked)["at_capacity"]["kind"], "agent_locked");
    assert!(blocked(&held).contains("Agents at capacity"), "{held}");
    assert!(!blocked(&freed).contains("Agents at capacity"), "{freed}");
}

#[tokio::test]
async fn the_app_wide_capacity_tool_is_gone() {
    let (mcp, _pool) = board().await;

    assert!(!mcp.tool_names().contains(&"arlesh_capacity".to_owned()));
}

// Child agents and the per-call `sub_token` (Task 077, ADR 0019).

/// Attaches as an agent holding the whole Arlesh project (domain 902).
async fn attach_on_project(mcp: &ArleshMcp, name: &str) -> Value {
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
            "subtree": { "node_type": "domain", "node_id": "902" },
        }),
    )
    .await
}

/// Registers a child of `session`'s agent: its sub-token.
async fn register(session: &ArleshMcp, client_id: &str) -> String {
    let answer = call(
        session,
        "arlesh_agents",
        json!({ "operation": "register_child", "name": "helper", "client_id": client_id }),
    )
    .await;
    structured(&answer)["sub_token"]
        .as_str()
        .expect("a sub-token")
        .to_owned()
}

async fn child_claims(session: &ArleshMcp, sub_token: &str, node_type: &str, id: &str) -> Value {
    call(
        session,
        "arlesh_agents",
        json!({
            "operation": "claim",
            "subtree": { "node_type": node_type, "node_id": id },
            "sub_token": sub_token,
        }),
    )
    .await
}

fn task_titles(answer: &Value) -> Vec<&str> {
    let mut titles: Vec<&str> = structured(answer)["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|task| task["title"].as_str())
        .collect();
    titles.sort_unstable();
    titles
}

#[tokio::test]
async fn every_tool_lists_the_optional_sub_token() {
    let (mcp, _pool) = board().await;

    for tool in mcp.tools() {
        let schema = &*tool.input_schema;
        assert_eq!(
            schema["properties"]["sub_token"]["type"], "string",
            "{}",
            tool.name
        );
        let required = schema["required"].as_array().cloned().unwrap_or_default();
        assert!(
            !required.iter().any(|field| field == "sub_token"),
            "{}",
            tool.name
        );
    }
}

#[tokio::test]
async fn a_child_sees_only_its_sub_claim_and_the_parent_all_of_its_claim() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;
    let token = register(&session, "sub-1").await;
    let claimed = child_claims(&session, &token, "task", "100").await;
    assert!(!is_error(&claimed), "{claimed}");
    assert_eq!(
        structured(&claimed)["claim_name"]
            .as_str()
            .map(|name| name.ends_with("Docs")),
        Some(true),
        "{claimed}"
    );

    let args = |extra: Value| {
        let mut base = json!({ "operation": "load", "sections": ["tasks"] });
        base.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        base
    };
    let child = call(
        &session,
        "arlesh_snapshot",
        args(json!({ "sub_token": token })),
    )
    .await;
    let parent = call(&session, "arlesh_snapshot", args(json!({}))).await;

    assert_eq!(task_titles(&child), ["Docs"], "{child}");
    assert_eq!(task_titles(&parent), ["Announce", "Docs"], "{parent}");
}

#[tokio::test]
async fn a_childs_write_outside_its_sub_claim_is_refused_and_the_parents_is_not() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;
    let token = register(&session, "sub-1").await;
    child_claims(&session, &token, "task", "100").await;
    let update = |extra: Value| {
        let mut base = json!({ "operation": "update", "id": "101", "title": "Renamed" });
        base.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        base
    };

    let as_child = call(
        &session,
        "arlesh_tasks",
        update(json!({ "sub_token": token })),
    )
    .await;
    let as_parent = call(&session, "arlesh_tasks", update(json!({}))).await;

    assert!(is_error(&as_child), "{as_child}");
    assert_eq!(structured(&as_child)["kind"], "not_permitted");
    assert!(!is_error(&as_parent), "{as_parent}");
}

#[tokio::test]
async fn a_child_cannot_claim_outside_its_parents_claim() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach(&session, "orchestrator", 10).await;
    let token = register(&session, "sub-1").await;

    let outside = child_claims(&session, &token, "goal", "11").await;
    let inside = child_claims(&session, &token, "task", "100").await;

    assert_eq!(structured(&outside)["kind"], "not_permitted", "{outside}");
    assert!(!is_error(&inside), "{inside}");
}

#[tokio::test]
async fn a_sub_token_of_another_sessions_child_is_refused() {
    let (mcp, _pool) = board().await;
    let first = session(&mcp);
    let second = session(&mcp);
    attach(&first, "one", 10).await;
    attach(&second, "two", 11).await;
    let token = register(&first, "sub-1").await;

    let answer = child_claims(&second, &token, "task", "101").await;

    assert_eq!(structured(&answer)["kind"], "not_permitted", "{answer}");
}

#[tokio::test]
async fn a_sub_token_that_is_not_a_string_or_has_no_session_is_refused() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;

    let not_a_string = call(
        &session,
        "arlesh_agents",
        json!({ "operation": "status", "sub_token": 7 }),
    )
    .await;
    let in_process = call(
        &ArleshMcp::new(mcp.factory.clone()),
        "arlesh_agents",
        json!({ "operation": "status", "sub_token": "x" }),
    )
    .await;

    assert_eq!(
        structured(&not_a_string)["kind"],
        "invalid_request",
        "{not_a_string}"
    );
    assert_eq!(
        structured(&in_process)["kind"],
        "invalid_request",
        "{in_process}"
    );
}

#[tokio::test]
async fn a_child_pauses_and_resumes_its_own_claim_with_its_sub_token() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;
    let token = register(&session, "sub-1").await;
    child_claims(&session, &token, "task", "100").await;
    let act = |operation: &str| json!({ "operation": operation, "sub_token": token });

    let paused = call(&session, "arlesh_agents", act("pause")).await;
    let parent = call(&session, "arlesh_agents", json!({ "operation": "status" })).await;
    let resumed = call(&session, "arlesh_agents", act("resume")).await;

    assert_eq!(structured(&paused)["standing"], "paused", "{paused}");
    assert_eq!(
        structured(&parent)["standing"],
        "active",
        "the parent is not paused"
    );
    assert_eq!(structured(&resumed)["standing"], "active", "{resumed}");
}

#[tokio::test]
async fn a_child_cannot_attach_lock_register_or_report_usage() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;
    let token = register(&session, "sub-1").await;

    for operation in [
        json!({ "operation": "lock" }),
        json!({ "operation": "unlock" }),
        json!({ "operation": "register_child", "name": "x", "client_id": "y" }),
        json!({ "operation": "report_usage", "windows": [] }),
        json!({ "operation": "attach", "session_id": "s", "pin": "1" }),
    ] {
        let mut arguments = operation.clone();
        arguments["sub_token"] = json!(token);
        let answer = call(&session, "arlesh_agents", arguments).await;
        assert_eq!(
            structured(&answer)["kind"],
            "invalid_request",
            "{operation}: {answer}"
        );
    }
}

#[tokio::test]
async fn registering_needs_an_attached_session_and_registering_again_rotates_the_token() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    let register_call =
        json!({ "operation": "register_child", "name": "helper", "client_id": "sub-1" });

    let unattached = call(&session, "arlesh_agents", register_call.clone()).await;
    attach_on_project(&session, "orchestrator").await;
    let first = call(&session, "arlesh_agents", register_call.clone()).await;
    let second = call(&session, "arlesh_agents", register_call).await;

    assert_eq!(
        structured(&unattached)["kind"],
        "not_permitted",
        "{unattached}"
    );
    let old = structured(&first)["sub_token"]
        .as_str()
        .expect("a sub-token");
    let new = structured(&second)["sub_token"]
        .as_str()
        .expect("a new sub-token");
    assert_ne!(old, new, "registering again gives a new token");
    assert_eq!(
        structured(&first)["agent"]["id"],
        structured(&second)["agent"]["id"]
    );
    assert!(
        structured(&first).get("claim_name").is_none(),
        "nothing is claimed yet"
    );
    let with_old = call(
        &session,
        "arlesh_agents",
        json!({ "operation": "status", "sub_token": old }),
    )
    .await;
    let with_new = call(
        &session,
        "arlesh_agents",
        json!({ "operation": "status", "sub_token": new }),
    )
    .await;
    assert_eq!(
        structured(&with_old)["kind"],
        "not_permitted",
        "the old token stops: {with_old}"
    );
    assert!(!is_error(&with_new), "{with_new}");
}

async fn set_status(session: &ArleshMcp, id: &str, expected: &str, status: &str) -> Value {
    call(
        session,
        "arlesh_tasks",
        json!({ "operation": "set_status", "id": id, "expected": expected, "status": status }),
    )
    .await
}

#[tokio::test]
async fn a_child_removed_because_an_agent_set_its_task_done_is_registered_afresh_when_the_task_is_reopened(
) {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;
    let old = register(&session, "sub-1").await;
    child_claims(&session, &old, "task", "100").await;

    let done = set_status(&session, "100", "todo", "done").await;
    let gone = call(
        &session,
        "arlesh_agents",
        json!({ "operation": "status", "sub_token": old }),
    )
    .await;
    let reopened = set_status(&session, "100", "done", "todo").await;
    let fresh = register(&session, "sub-1").await;
    let claimed = child_claims(&session, &fresh, "task", "100").await;
    let read = call(
        &session,
        "arlesh_snapshot",
        json!({ "operation": "load", "sections": ["tasks"], "sub_token": fresh }),
    )
    .await;

    assert!(!is_error(&done), "{done}");
    assert_eq!(
        structured(&gone)["kind"],
        "not_permitted",
        "the child went with its Task: {gone}"
    );
    assert!(!is_error(&reopened), "{reopened}");
    assert_ne!(old, fresh, "a fresh child has a fresh token");
    assert!(!is_error(&claimed), "{claimed}");
    assert_eq!(task_titles(&read), ["Docs"], "{read}");
}

fn message(answer: &Value) -> String {
    structured(answer)["message"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

#[tokio::test]
async fn a_paused_childs_write_is_refused_saying_it_is_paused() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;
    let token = register(&session, "sub-1").await;
    child_claims(&session, &token, "task", "100").await;
    call(
        &session,
        "arlesh_agents",
        json!({ "operation": "pause", "sub_token": token }),
    )
    .await;

    let refused = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "update", "id": "100", "title": "Renamed", "sub_token": token }),
    )
    .await;

    assert_eq!(structured(&refused)["kind"], "not_permitted", "{refused}");
    let said = message(&refused);
    assert!(said.contains("Your Claim is paused"), "{said}");
    assert!(
        said.contains("parent agent or the user resumes it"),
        "{said}"
    );
}

#[tokio::test]
async fn a_node_outside_the_sub_claim_but_inside_the_parents_is_refused_saying_so() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;
    let token = register(&session, "sub-1").await;
    child_claims(&session, &token, "task", "100").await;

    let read = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "101", "sub_token": token }),
    )
    .await;
    let write = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "update", "id": "101", "title": "Renamed", "sub_token": token }),
    )
    .await;

    for answer in [&read, &write] {
        assert_eq!(structured(answer)["kind"], "not_permitted", "{answer}");
        let said = message(answer);
        assert!(said.contains("is outside your Claim"), "{said}");
        assert!(said.contains("arlesh_agents.claim"), "{said}");
    }
}

#[tokio::test]
async fn a_node_outside_the_parents_claim_keeps_the_generic_refusal() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach(&session, "orchestrator", 10).await;
    let token = register(&session, "sub-1").await;
    child_claims(&session, &token, "task", "100").await;

    let read = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "101", "sub_token": token }),
    )
    .await;
    let parents = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "101" }),
    )
    .await;

    assert_eq!(structured(&read)["kind"], "not_permitted", "{read}");
    assert_eq!(
        message(&read),
        message(&parents),
        "the child learns nothing the parent was not told"
    );
    assert!(!message(&read).contains("Claim"), "{}", message(&read));
}

/// `register_child` with a `subtree`: the answer.
async fn register_holding(
    session: &ArleshMcp,
    client_id: &str,
    node_type: &str,
    id: &str,
) -> Value {
    call(
        session,
        "arlesh_agents",
        json!({
            "operation": "register_child",
            "name": "helper",
            "client_id": client_id,
            "subtree": { "node_type": node_type, "node_id": id },
        }),
    )
    .await
}

#[tokio::test]
async fn a_child_registered_with_a_task_holds_it_at_once() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;

    let answer = register_holding(&session, "sub-1", "task", "100").await;

    assert!(!is_error(&answer), "{answer}");
    let identity = structured(&answer);
    assert!(identity["sub_token"].is_string(), "{answer}");
    assert_eq!(identity["standing"], "active", "{answer}");
    assert!(identity.get("claim_refused").is_none(), "{answer}");
    assert_eq!(
        identity["agent"]["claim"]["root"]["node_kind"], "task",
        "{answer}"
    );
    assert!(
        identity["claim_name"]
            .as_str()
            .is_some_and(|name| name.ends_with("Docs")),
        "{answer}"
    );
    let token = identity["sub_token"].as_str().unwrap().to_owned();
    let seen = call(
        &session,
        "arlesh_snapshot",
        json!({ "operation": "load", "sections": ["tasks"], "sub_token": token }),
    )
    .await;
    assert_eq!(task_titles(&seen), ["Docs"], "{seen}");
}

#[tokio::test]
async fn a_task_outside_the_parents_claim_leaves_the_child_registered_and_unclaimed() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach(&session, "orchestrator", 10).await;

    let answer = register_holding(&session, "sub-1", "task", "101").await;

    assert!(!is_error(&answer), "the child is registered: {answer}");
    let identity = structured(&answer);
    assert!(identity["sub_token"].is_string(), "{answer}");
    assert_eq!(identity["standing"], "unclaimed", "{answer}");
    assert!(identity["agent"]["claim"].is_null(), "{answer}");
    let why = identity["claim_refused"]
        .as_str()
        .expect("the answer says why");
    assert!(
        why.contains("not inside your parent agent's Claim"),
        "{why}"
    );
}

#[tokio::test]
async fn a_task_a_sibling_holds_is_refused_naming_the_sibling_and_the_child_is_still_registered() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;
    register_holding(&session, "sub-1", "task", "100").await;

    let answer = register_holding(&session, "sub-2", "task", "100").await;

    assert!(!is_error(&answer), "{answer}");
    let why = structured(&answer)["claim_refused"]
        .as_str()
        .expect("refused")
        .to_owned();
    assert!(why.contains("overlaps the active claim"), "{why}");
    assert_eq!(structured(&answer)["standing"], "unclaimed", "{answer}");
}

#[tokio::test]
async fn a_task_that_names_nothing_is_refused_without_saying_what_exists() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;

    let answer = register_holding(&session, "sub-1", "task", "ffffff").await;

    assert!(!is_error(&answer), "{answer}");
    assert!(structured(&answer)["claim_refused"].is_string(), "{answer}");
    assert_eq!(structured(&answer)["standing"], "unclaimed", "{answer}");
}

#[tokio::test]
async fn registering_again_with_a_task_rotates_the_token_and_claims_it() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;
    let first = register(&session, "sub-1").await;

    let again = register_holding(&session, "sub-1", "task", "100").await;

    let rotated = structured(&again)["sub_token"]
        .as_str()
        .expect("a new token");
    assert_ne!(rotated, first);
    assert_eq!(structured(&again)["standing"], "active", "{again}");
}

#[tokio::test]
async fn a_tasks_get_answers_its_short_id_and_title_for_the_mod_to_label_a_subagent_by() {
    let (mcp, _pool) = board().await;
    let session = session(&mcp);
    attach_on_project(&session, "orchestrator").await;

    let answer = call(
        &session,
        "arlesh_tasks",
        json!({ "operation": "get", "id": "100" }),
    )
    .await;

    let task = &structured(&answer)["task"];
    assert!(task["short_id"].is_string(), "{answer}");
    assert_eq!(task["title"], "Docs", "{answer}");
}
