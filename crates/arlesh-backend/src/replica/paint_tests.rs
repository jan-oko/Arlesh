//! Every write the port offers, made on the Replica while the server is held: each must change the
//! Replica's board and publish it before the server has answered (ADR 0017, decision 6).
//!
//! The table below has one scripted call per `write` or `create` method of [`super::ports`], and
//! the test fails when the table and that list differ, so a new write cannot be added without
//! being shown to paint.

use std::{collections::BTreeSet, sync::Arc, time::Duration};

use arlesh_core::{
    agents::model::AgentAction,
    domains::model::{CreateDomainRequest, DomainSubtype, UpdateDomainRequest},
    error::WireError,
    flows::model::{
        CreateFlowItemRequest, CreateFlowRequest, FlowCycleInput, FlowItemType, SetRecurrenceRequest,
        StartFlowRequest, UpdateFlowItemRequest, UpdateFlowRequest,
    },
    infos::model::{CreateInfoRequest, UpdateInfoRequest},
    nodes::{
        gestures::{steps::{GestureStep, StepEntry}, GestureName, GestureNode},
        id::{NodeId, RowId},
    },
    tasks::{
        answer_drafts::model::{DraftRequest, SendRequest},
        model::{
            CreateCommitmentRequest, CreateExpectationRequest, CreateGoalRequest, CreateTaskRequest,
            AsyncTemplate, Dependency, DescendantPlans, DurationSpec, TaskAgentic, UpdateCommitmentRequest,
            UpdateExpectationRequest, UpdateGoalRequest, UpdateSpawnedWaitRequest,
            UpdateTaskRequest,
        },
        rules::gestures::{StatusStep, VerdictPress},
    },
};
use serde_json::json;

use super::{
    tests::{first_project, task, Rig},
    BoxFuture, ReplicaBackend,
};
use crate::{
    access::AccessPort, agents::AgentsPort, block_reasons::BlockReasonsPort,
    commitments::CommitmentsPort, domains::DomainsPort, expectations::WaitsPort, flows::FlowsPort,
    gestures::GesturesPort, infos::InfosPort, node_gestures::NodeGesturesPort, tasks::TasksPort,
};

const PORTS: &str = include_str!("ports.rs");

/// The ids a script works on, all on the confirmed board before the Replica makes anything.
#[derive(Clone)]
struct Fx {
    aspect: RowId,
    project: RowId,
    tag: RowId,
    task: NodeId,
    task2: NodeId,
    task3: NodeId,
    goal: NodeId,
    goal2: NodeId,
    commitment: NodeId,
    commitment2: NodeId,
    wait: NodeId,
    wait2: NodeId,
    check: NodeId,
    check2: NodeId,
    task4: NodeId,
    spawned: [NodeId; 3],
    info: RowId,
    flow: RowId,
    flow2: RowId,
    flow3: RowId,
    started: chrono::NaiveDateTime,
    flow_task: RowId,
    flow_goal: RowId,
    flow_commitment: RowId,
    flow_expectation: RowId,
}

fn time_scope() -> arlesh_core::tasks::model::TimeScope {
    serde_json::from_value(json!({
        "start_id": {"kind": "day", "date": "2026-12-01"},
        "end_id": {"kind": "day", "date": "2026-12-01"}
    }))
    .expect("a time scope")
}

/// When the wait's newest completed check fell due, read from the Replica's own board.
async fn latest_check(
    replica: &ReplicaBackend,
    wait: arlesh_core::tasks::waits::WaitRef,
) -> Result<chrono::NaiveDateTime, WireError> {
    let local = replica.local().await?;
    let mut db = local.factory().connect().await.map_err(WireError::from_error)?;
    let checks = db.tasks().wait_checks(&wait).await.map_err(WireError::from_error)?;
    checks
        .last()
        .map(|check| check.due_at)
        .ok_or_else(|| WireError::invalid_request("no completed check"))
}

fn row(id: &NodeId) -> RowId {
    id.require_stored().expect("a stored id")
}

async fn fixture(rig: &Rig) -> Fx {
    let server = &rig.server.bracketed;
    let aspect = {
        let mut db = rig.server.backend.factory().connect().await.expect("a session");
        db.domains()
            .list(Some(DomainSubtype::Aspect))
            .await
            .expect("aspects")[0]
            .id
    };
    let domain = |title: &str, subtype, parent| CreateDomainRequest {
        id: None,
        title: title.into(),
        description: None,
        subtype,
        parent_id: Some(parent),
        status: None,
        knowledge_base_directory: None,
    };
    let project = server
        .create_domain(domain("Painting", DomainSubtype::Project, aspect))
        .await
        .expect("project")
        .id;
    let tag = server
        .create_domain(domain("a tag", DomainSubtype::Tag, aspect))
        .await
        .expect("tag")
        .id;
    let under = NodeId::from(project);
    let mk_task = |title: &str| task(title, "project", under.clone());
    let task1 = server.create_task(mk_task("One")).await.expect("task").id;
    let task2 = server.create_task(mk_task("Two")).await.expect("task").id;
    let task3 = server.create_task(mk_task("Three")).await.expect("task").id;
    let goal_of = |title: &str| CreateGoalRequest {
        title: title.into(),
        parent_type: "project".into(),
        parent_id: under.clone(),
        ..Default::default()
    };
    let goal = server.create_goal(goal_of("Goal")).await.expect("goal").id;
    let goal2 = server.create_goal(goal_of("Goal two")).await.expect("goal").id;
    let commit = |title: &str| CreateCommitmentRequest {
        title: title.into(),
        parent_type: "project".into(),
        parent_id: under.clone(),
        time_scope: Some(time_scope()),
        ..Default::default()
    };
    let commitment = server.create_commitment(commit("Promise")).await.expect("commitment").id;
    let commitment2 = server.create_commitment(commit("Promise two")).await.expect("commitment").id;
    let agentic = server
        .create_task(CreateTaskRequest {
            agentic: Some(TaskAgentic::Yes),
            ..mk_task("Agent work")
        })
        .await
        .expect("agentic task")
        .id;
    let wait = server
        .create_expectation(CreateExpectationRequest {
            title: "Which one?".into(),
            parent_type: "task".into(),
            parent_id: agentic.clone(),
            agentic: true,
            agentic_note: Some("Pick".into()),
            ..Default::default()
        })
        .await
        .expect("wait")
        .id;
    let wait2 = server
        .create_expectation(CreateExpectationRequest {
            title: "Which other?".into(),
            parent_type: "task".into(),
            parent_id: agentic.clone(),
            agentic: true,
            agentic_note: Some("Pick again".into()),
            ..Default::default()
        })
        .await
        .expect("wait")
        .id;
    let started = at() - chrono::Duration::days(3);
    let checking = |title: &str| CreateExpectationRequest {
        title: title.into(),
        parent_type: "task".into(),
        parent_id: task2.clone(),
        check_every: Some(DurationSpec { n: 1, kind: "day".into() }),
        check_starting: Some(started),
        ..Default::default()
    };
    server
        .save_answer_draft(wait2.clone(), DraftRequest { answer: Some("Draft".into()), verdict: None })
        .await
        .expect("a draft");
    let check = server.create_expectation(checking("Heard back?")).await.expect("check").id;
    let check2 = server.create_expectation(checking("Heard again?")).await.expect("check").id;
    let task4 = server.create_task(mk_task("Four")).await.expect("task").id;
    let mut spawned = Vec::new();
    for title in ["Awaiting one", "Awaiting two", "Awaiting three"] {
        let waiting = server
            .create_task(CreateTaskRequest {
                asynchronous: Some(true),
                async_template: Some(AsyncTemplate {
                    title: "Did it land?".into(),
                    check_every: Some(DurationSpec { n: 1, kind: "day".into() }),
                    ..Default::default()
                }),
                ..mk_task(title)
            })
            .await
            .expect("an asynchronous task")
            .id;
        let done: UpdateTaskRequest =
            serde_json::from_value(json!({"status": {"kind": "ordinary", "status": "done"}})).expect("a status");
        server.update_task(waiting.clone(), done, None).await.expect("done");
        server
            .set_task_done_at(waiting.clone(), started)
            .await
            .expect("done earlier");
        spawned.push(waiting);
    }
    let spawned: [NodeId; 3] = spawned.try_into().expect("three");
    // Two waits with a completed check, for the scripts that reopen one.
    server.complete_expectation_check(row(&check2)).await.expect("a check");
    server.complete_spawned_wait_check(row(&spawned[2])).await.expect("a check");
    let info = server
        .create_info(CreateInfoRequest {
            id: None,
            body: "A note".into(),
            details: None,
            parent_type: "task".into(),
            parent_id: task1.clone(),
            position: 0,
        })
        .await
        .expect("info")
        .id;
    let flow_of = |title: &str| CreateFlowRequest {
        title: title.into(),
        parent_type: "domain".into(),
        parent_id: project,
        ..Default::default()
    };
    let flow = server.create_flow(flow_of("Routine")).await.expect("flow").id;
    let flow2 = server.create_flow(flow_of("Routine two")).await.expect("flow").id;
    let flow3 = server.create_flow(flow_of("Routine three")).await.expect("flow").id;
    server
        .create_flow_task(CreateFlowItemRequest {
            flow_id: flow3,
            title: "Only step".into(),
            parent_type: "flow".into(),
            parent_id: flow3,
            ..Default::default()
        })
        .await
        .expect("item");
    let item = |title: &str| CreateFlowItemRequest {
        flow_id: flow,
        title: title.into(),
        parent_type: "flow".into(),
        parent_id: flow,
        ..Default::default()
    };
    let flow_task = server.create_flow_task(item("Step")).await.expect("item").id;
    let flow_goal = server.create_flow_goal(item("Aim")).await.expect("item").id;
    let flow_commitment = server.create_flow_commitment(item("Vow")).await.expect("item").id;
    let flow_expectation = server.create_flow_expectation(item("Hope")).await.expect("item").id;
    Fx {
        aspect,
        project,
        tag,
        task: task1,
        task2,
        task3,
        goal,
        goal2,
        commitment,
        commitment2,
        wait,
        wait2,
        check,
        check2,
        task4,
        spawned,
        info,
        flow,
        flow2,
        flow3,
        started,
        flow_task,
        flow_goal,
        flow_commitment,
        flow_expectation,
    }
}

type Script = Box<dyn Fn(Arc<ReplicaBackend>, Fx) -> BoxFuture<'static, Result<(), WireError>>>;

macro_rules! script {
    ($name:literal, |$r:ident, $f:ident| $call:expr) => {
        (
            $name,
            Box::new(move |$r: Arc<ReplicaBackend>, $f: Fx| {
                Box::pin(async move { $call.await.map(|_| ()) }) as BoxFuture<'static, _>
            }) as Script,
        )
    };
}

fn at() -> chrono::NaiveDateTime {
    arlesh_core::clock::now()
}

fn table() -> Vec<(&'static str, Script)> {
    vec![
        script!("create_task", |r, f| r.create_task(task("Painted", "project", NodeId::from(f.project)))),
        script!("update_task", |r, f| r.update_task(f.task.clone(), UpdateTaskRequest { title: Some("Retitled".into()), ..Default::default() }, None)),
        script!("update_task_settling_plans", |r, f| r.update_task_settling_plans(f.task3.clone(), UpdateTaskRequest { title: Some("Retitled three".into()), ..Default::default() }, None, DescendantPlans::Clear)),
        script!("step_task_status", |r, f| r.step_task_status(f.task2.clone(), StatusStep::Advance, None)),
        script!("toggle_task_agentic", |r, f| r.toggle_task_agentic(f.task3.clone())),
        script!("duplicate_task", |r, f| r.duplicate_task(row(&f.task3), "project".into(), f.project, 0)),
        script!("add_task_dependency", |r, f| r.add_task_dependency(f.task.clone(), Dependency::Task { id: f.task3.clone() })),
        script!("remove_task_dependency", |r, f| r.remove_task_dependency(f.task.clone(), Dependency::Task { id: f.task3.clone() })),
        script!("add_tag_to_task", |r, f| r.add_tag_to_task(f.task.clone(), f.tag)),
        script!("remove_tag_from_task", |r, f| r.remove_tag_from_task(f.task.clone(), f.tag)),
        script!("set_task_done_at", |r, f| async move {
            let done: UpdateTaskRequest = serde_json::from_value(json!({"status": {"kind": "ordinary", "status": "done"}}))
                .map_err(|error| WireError::invalid_request(error.to_string()))?;
            r.update_task(f.task.clone(), done, None).await?;
            r.set_task_done_at(f.task.clone(), at()).await
        }),
        script!("create_goal", |r, f| r.create_goal(CreateGoalRequest { title: "New goal".into(), parent_type: "project".into(), parent_id: NodeId::from(f.project), ..Default::default() })),
        script!("update_goal", |r, f| r.update_goal(f.goal.clone(), UpdateGoalRequest { title: Some("Goal, renamed".into()), ..Default::default() }, None)),
        script!("duplicate_goal", |r, f| r.duplicate_goal(row(&f.goal), "project".into(), f.project, 0)),
        script!("add_tag_to_goal", |r, f| r.add_tag_to_goal(f.goal.clone(), f.tag)),
        script!("remove_tag_from_goal", |r, f| r.remove_tag_from_goal(f.goal.clone(), f.tag)),
        script!("create_commitment", |r, f| r.create_commitment(CreateCommitmentRequest { title: "Another".into(), parent_type: "project".into(), parent_id: NodeId::from(f.project), time_scope: Some(time_scope()), ..Default::default() })),
        script!("update_commitment", |r, f| r.update_commitment(f.commitment.clone(), UpdateCommitmentRequest { title: Some("Promise, renamed".into()), ..Default::default() })),
        script!("press_commitment_verdict", |r, f| r.press_commitment_verdict(f.commitment2.clone(), VerdictPress::Kept)),
        script!("add_tag_to_commitment", |r, f| r.add_tag_to_commitment(f.commitment.clone(), f.tag)),
        script!("remove_tag_from_commitment", |r, f| r.remove_tag_from_commitment(f.commitment.clone(), f.tag)),
        script!("create_expectation", |r, f| r.create_expectation(CreateExpectationRequest { title: "New wait".into(), parent_type: "task".into(), parent_id: f.task3.clone(), ..Default::default() })),
        script!("update_expectation", |r, f| r.update_expectation(f.check.clone(), UpdateExpectationRequest { title: Some("Heard back, renamed".into()), ..Default::default() })),
        script!("complete_expectation_check", |r, f| r.complete_expectation_check(row(&f.check))),
        script!("reopen_expectation_check", |r, f| async move {
            let due = latest_check(&r, arlesh_core::tasks::waits::WaitRef::Stored(row(&f.check2))).await?;
            r.reopen_expectation_check(row(&f.check2), due).await
        }),
        script!("add_tag_to_expectation", |r, f| r.add_tag_to_expectation(f.check.clone(), f.tag)),
        script!("remove_tag_from_expectation", |r, f| r.remove_tag_from_expectation(f.check.clone(), f.tag)),
        script!("clear_answer_draft", |r, f| async move {
            r.clear_answer_draft(f.wait2.clone()).await
        }),
        script!("save_answer_draft", |r, f| r.save_answer_draft(f.wait.clone(), DraftRequest { answer: Some("The second".into()), verdict: None })),
        script!("send_answer_drafts", |r, f| r.send_answer_drafts(SendRequest { shown: vec![f.wait.clone()] })),
        script!("update_spawned_wait", |r, f| r.update_spawned_wait(row(&f.spawned[0]), serde_json::from_value::<UpdateSpawnedWaitRequest>(json!({"archival": "archived"})).expect("a request"))),
        script!("complete_spawned_wait_check", |r, f| r.complete_spawned_wait_check(row(&f.spawned[1]))),
        script!("reopen_spawned_wait_check", |r, f| async move {
            let due = latest_check(&r, arlesh_core::tasks::waits::WaitRef::Spawned(row(&f.spawned[2]))).await?;
            r.reopen_spawned_wait_check(row(&f.spawned[2]), due).await
        }),
        script!("create_info", |r, f| r.create_info(CreateInfoRequest { id: None, body: "Another note".into(), details: None, parent_type: "task".into(), parent_id: f.task.clone(), position: 1 })),
        script!("update_info", |r, f| r.update_info(f.info, UpdateInfoRequest { body: Some("A note, edited".into()), ..Default::default() })),
        script!("duplicate_info", |r, f| r.duplicate_info(f.info, "task".into(), row(&f.task2), 0)),
        script!("create_domain", |r, f| r.create_domain(CreateDomainRequest { id: None, title: "A second project".into(), description: None, subtype: DomainSubtype::Project, parent_id: Some(f.aspect), status: None, knowledge_base_directory: None })),
        script!("update_domain", |r, f| r.update_domain(f.project, UpdateDomainRequest { title: Some("Painting, renamed".into()), ..Default::default() })),
        script!("duplicate_domain", |r, f| r.duplicate_domain(f.project, f.aspect, 0)),
        script!("create_flow", |r, f| r.create_flow(CreateFlowRequest { title: "New flow".into(), parent_type: "domain".into(), parent_id: f.project, ..Default::default() })),
        script!("update_flow", |r, f| r.update_flow(f.flow, UpdateFlowRequest { title: Some("Routine, renamed".into()), ..Default::default() })),
        script!("create_flow_task", |r, f| r.create_flow_task(CreateFlowItemRequest { flow_id: f.flow, title: "More".into(), parent_type: "flow".into(), parent_id: f.flow, ..Default::default() })),
        script!("create_flow_goal", |r, f| r.create_flow_goal(CreateFlowItemRequest { flow_id: f.flow, title: "More aims".into(), parent_type: "flow".into(), parent_id: f.flow, ..Default::default() })),
        script!("create_flow_commitment", |r, f| r.create_flow_commitment(CreateFlowItemRequest { flow_id: f.flow, title: "More vows".into(), parent_type: "flow".into(), parent_id: f.flow, ..Default::default() })),
        script!("create_flow_expectation", |r, f| r.create_flow_expectation(CreateFlowItemRequest { flow_id: f.flow, title: "More hopes".into(), parent_type: "flow".into(), parent_id: f.flow, ..Default::default() })),
        script!("update_flow_task", |r, f| r.update_flow_task(f.flow_task, UpdateFlowItemRequest { title: Some("Step, renamed".into()), ..Default::default() })),
        script!("update_flow_goal", |r, f| r.update_flow_goal(f.flow_goal, UpdateFlowItemRequest { title: Some("Aim, renamed".into()), ..Default::default() })),
        script!("update_flow_commitment", |r, f| r.update_flow_commitment(f.flow_commitment, UpdateFlowItemRequest { title: Some("Vow, renamed".into()), ..Default::default() })),
        script!("update_flow_expectation", |r, f| r.update_flow_expectation(f.flow_expectation, UpdateFlowItemRequest { title: Some("Hope, renamed".into()), ..Default::default() })),
        script!("add_flow_dependency", |r, f| r.add_flow_dependency(f.flow, FlowItemType::FlowTask, f.flow_task, FlowItemType::FlowGoal, f.flow_goal)),
        script!("remove_flow_dependency", |r, f| r.remove_flow_dependency(FlowItemType::FlowTask, f.flow_task, FlowItemType::FlowGoal, f.flow_goal)),
        script!("set_flow_item_cycles", |r, f| r.set_flow_item_cycles(f.flow, FlowItemType::FlowTask, f.flow_task, vec![FlowCycleInput::default()], None, None)),
        script!("set_flow_recurrence", |r, f| async move {
            let request: SetRecurrenceRequest = serde_json::from_value(json!({
                "start_scope_id": {"kind": "day", "date": "2026-12-01"},
                "gap_n": 1, "gap_kind": "week", "clock": "interval"
            })).map_err(|error| WireError::invalid_request(error.to_string()))?;
            r.set_flow_recurrence(f.flow, request).await
        }),
        script!("delete_flow_recurrence", |r, f| r.delete_flow_recurrence(f.flow)),
        script!("start_flow", |r, f| r.start_flow(f.flow3, StartFlowRequest { title: "Started".into(), target_type: "domain".into(), target_id: f.project, anchor_date: at().date() })),
        script!("fork_flow", |r, f| r.fork_flow(f.flow, at())),
        script!("duplicate_flow", |r, f| r.duplicate_flow(f.flow, "project".into(), f.project, 0)),
        script!("duplicate_flow_item", |r, f| r.duplicate_flow_item(FlowItemType::FlowTask, f.flow_task, "flow".into(), f.flow, 0)),
        script!("clear_habit_modifications", |r, f| r.clear_habit_modifications(f.flow)),
        script!("convert_to_flow", |r, f| r.convert_to_flow("task".into(), row(&f.task4), false, false)),
        script!("set_block_reasons", |r, f| r.set_block_reasons("task".into(), f.task.clone(), vec!["waiting on paint".into()])),
        script!("add_mcp_root", |r, f| r.add_mcp_root(arlesh_core::access::model::NodeTable::Task, row(&f.task2))),
        script!("remove_mcp_root", |r, f| r.remove_mcp_root(arlesh_core::access::model::NodeTable::Task, row(&f.task2))),
        script!("set_agent_account_locked", |r, _f| r.set_agent_account_locked("default".into(), true)),
        script!("apply_agent_action", |r, _f| r.apply_agent_action(1, AgentAction::Lock { locked: true })),
        script!("run_gesture", |r, f| r.run_gesture(GestureName::SaveTask, vec![StepEntry {
            step: GestureStep::CreateTask { request: task("By gesture", "project", NodeId::from(f.project)) },
            may_be_refused: false,
        }])),
        script!("delete_nodes", |r, f| r.delete_nodes(vec![GestureNode { kind: "task".into(), id: f.task2.clone() }])),
        script!("delete_task", |r, f| r.delete_task(f.task3.clone())),
        script!("delete_goal", |r, f| r.delete_goal(f.goal2.clone())),
        script!("delete_commitment", |r, f| r.delete_commitment(f.commitment2.clone())),
        script!("delete_expectation", |r, f| r.delete_expectation(f.wait.clone())),
        script!("delete_info", |r, f| r.delete_info(f.info)),
        script!("delete_flow_item", |r, f| r.delete_flow_item(FlowItemType::FlowExpectation, f.flow_expectation)),
        script!("delete_flow", |r, f| r.delete_flow(f.flow2)),
        script!("delete_domain", |r, f| r.delete_domain(f.tag)),
    ]
}

/// Writes that, on this board, have nothing stored to change: they still answer at once and publish.
const NO_ROW_TO_CHANGE: &[&str] = &[
    // A Flow that is not a Habit has no modifications to clear.
    "clear_habit_modifications",
];

/// The `write` and `create` methods of the port list.
fn predicted_methods() -> BTreeSet<String> {
    PORTS
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line
                .strip_prefix("write ")
                .or_else(|| line.strip_prefix("create "))?;
            rest.contains('(').then(|| {
                rest.chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect()
            })
        })
        .collect()
}

#[test]
fn the_table_has_one_script_per_predicted_method() {
    let scripted: BTreeSet<String> = table().iter().map(|(name, _)| (*name).to_owned()).collect();
    let predicted = predicted_methods();
    assert_eq!(
        scripted.difference(&predicted).collect::<Vec<_>>(),
        Vec::<&String>::new(),
        "scripted but not a predicted method"
    );
    assert_eq!(
        predicted.difference(&scripted).collect::<Vec<_>>(),
        Vec::<&String>::new(),
        "predicted but not scripted"
    );
}

#[tokio::test]
async fn every_board_write_paints_before_the_server_answers() {
    let rig = Rig::start(|_| Vec::new()).await;
    // The board a script works on, and an agent for the agent writes.
    rig.server
        .sql("INSERT INTO agents (id, name, account, session_uuid, token_sha256, created_at) VALUES (1, 'painter', 'default', 's1', 'T1', 'x')")
        .await;
    let fx = fixture(&rig).await;
    rig.server.backend.record_write();
    rig.converge().await;
    let _ = first_project(&rig).await;

    let mut failures = Vec::new();
    for (name, script) in table() {
        let painted = rig.published.lock().expect("lock").len();
        let rows = rig.replica_rows().await;
        rig.gate.hold();

        let outcome = tokio::time::timeout(
            Duration::from_secs(10),
            script(Arc::clone(&rig.replica), fx.clone()),
        )
        .await;
        let settled = match outcome {
            Ok(Ok(())) => {
                let start = std::time::Instant::now();
                while rig.published.lock().expect("lock").len() <= painted
                    && start.elapsed() < Duration::from_secs(5)
                {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                let showed = rig.published.lock().expect("lock").len() > painted;
                let changed = rig.replica_rows().await != rows;
                if !(showed && (changed || NO_ROW_TO_CHANGE.contains(&name))) {
                    failures.push(format!("{name}: published={showed} rows_changed={changed}"));
                }
                true
            }
            Ok(Err(error)) => {
                failures.push(format!("{name}: refused locally: {error:?}"));
                false
            }
            Err(_) => {
                failures.push(format!("{name}: no answer"));
                false
            }
        };
        rig.gate.release();
        if settled {
            rig.converge().await;
        }
    }

    assert!(failures.is_empty(), "{} of the writes did not paint:\n{}", failures.len(), failures.join("\n"));
}

#[tokio::test]
async fn replica_and_server_end_byte_identical_after_a_mixed_session() {
    let rig = Rig::start(|_| Vec::new()).await;
    rig.server
        .sql("INSERT INTO agents (id, name, account, session_uuid, token_sha256, created_at) VALUES (1, 'painter', 'default', 's1', 'T1', 'x')")
        .await;
    let fx = fixture(&rig).await;
    rig.server.backend.record_write();
    rig.converge().await;

    // Every kind of write, fired without waiting for the server, with another client writing
    // among them, and undo and redo at the end.
    let scripts = table();
    let half = scripts.len() / 2;
    for (index, (name, script)) in scripts.into_iter().enumerate() {
        script(Arc::clone(&rig.replica), fx.clone())
            .await
            .unwrap_or_else(|error| panic!("{name}: {error:?}"));
        if index == half {
            rig.server
                .bracketed
                .create_task(task("From another client", "project", NodeId::from(fx.project)))
                .await
                .expect("another client's write");
        }
    }
    rig.converge().await;
    assert!(rig.dropped.lock().expect("lock").is_empty(), "nothing was refused");

    use crate::undo::UndoPort;
    rig.replica.undo().await.expect("an undo");
    rig.converge().await;
    rig.replica.redo().await.expect("a redo");
    rig.converge().await;
    assert_eq!(rig.replica_rows().await, rig.server.rows().await);
}
