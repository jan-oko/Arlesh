//! The lock as a derived block: who it blocks, and how the reason is carried.

use super::*;
use crate::{
    domains::model::Domain,
    filters::{facts, model::NodeKind, tree::FactNode},
    tasks::model::{Expectation, ExpectationStatus, Goal, Task, TaskArchival},
};

fn domain_row(id: i64, parent: Option<i64>) -> Domain {
    Domain {
        id,
        title: format!("domain {id}"),
        description: None,
        subtype: if parent.is_none() {
            "aspect"
        } else {
            "project"
        }
        .to_string(),
        parent_id: parent,
        color: None,
        status: parent.map(|_| "active".to_string()),
        knowledge_base_directory: None,
        position: id,
        is_private: false,
    }
}

fn goal_row(id: i64, parent_type: &str, parent_id: i64) -> Goal {
    Goal {
        id: id.into(),
        title: format!("goal {id}"),
        parent_type: parent_type.to_string(),
        parent_id: parent_id.into(),
        status: "active".to_string(),
        time_scope: None,
        on_scope_exit: None,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        origin: Default::default(),
    }
}

fn task_row(
    id: i64,
    parent_type: &str,
    parent_id: i64,
    status: &str,
    agentic: Option<bool>,
) -> Task {
    Task {
        id: id.into(),
        title: format!("task {id}"),
        parent_type: parent_type.to_string(),
        parent_id: parent_id.into(),
        status: crate::tasks::model::Status::from_db(status).expect("a stored status"),
        delegate_to: None,
        agentic,
        asynchronous: false,
        compound: false,
        async_template: None,
        agentic_brief: None,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        due_scope: None,
        archival: TaskArchival::Live,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        origin: Default::default(),
    }
}

/// An Aspect and a Project holding:
///
/// - task 20, Agentic, Doing
///   - goal 30
///     - task 31, To Do, inherits Agentic through the Goal
///   - task 21, On Agent, inherits
///   - task 22, Done, inherits
///   - task 23, To Do, explicitly Not agentic
///     - task 24, To Do, inherits Not agentic
/// - task 40, To Do, nothing anywhere above it says Agentic
fn board() -> MindmapLoad {
    MindmapLoad {
        domains: vec![domain_row(1, None), domain_row(2, Some(1))],
        goals: vec![goal_row(30, "task", 20)],
        tasks: vec![
            task_row(20, "project", 2, "doing", Some(true)),
            task_row(31, "goal", 30, "agentic_todo", None),
            task_row(21, "task", 20, "on_agent", None),
            task_row(22, "task", 20, "agentic_done", None),
            task_row(23, "task", 20, "todo", Some(false)),
            task_row(24, "task", 23, "todo", None),
            task_row(40, "project", 2, "todo", None),
        ],
        ..MindmapLoad::default()
    }
}

fn sorted(mut ids: Vec<NodeId>) -> Vec<NodeId> {
    ids.sort();
    ids
}

#[test]
fn it_blocks_every_agentic_task_not_yet_done_own_flag_or_inherited() {
    assert_eq!(
        sorted(blocked_tasks(Rows::of(&board()))),
        sorted(vec![20.into(), 21.into(), 31.into()])
    );
}

#[test]
fn off_it_adds_nothing() {
    let mut load = board();
    apply(&mut load, false);
    assert!(load.block_reasons.is_empty());
}

#[test]
fn on_it_adds_one_derived_reason_per_blocked_task_after_its_own() {
    let mut load = board();
    load.block_reasons.push(BlockReason {
        owner_type: "task".to_string(),
        owner_id: 20.into(),
        reason: "waiting on review".to_string(),
        position: 0,
        derived: None,
        until: None,
    });

    apply(&mut load, true);

    let derived: Vec<&BlockReason> = load
        .block_reasons
        .iter()
        .filter(|reason| reason.derived == Some(DerivedBlock::AgentCapacity))
        .collect();
    assert_eq!(derived.len(), 3);
    assert!(derived
        .iter()
        .all(|reason| reason.reason == AGENT_CAPACITY_REASON));
    let on_20 = derived
        .iter()
        .find(|reason| reason.owner_id.stored() == Some(20))
        .unwrap();
    assert_eq!(on_20.position, 1, "numbered on from the Task's own reason");
}

#[test]
fn an_agentic_wait_is_not_blocked() {
    let mut load = board();
    let mut wait = expectation_under(20);
    wait.agentic = true;
    wait.status = ExpectationStatus::Pending;
    load.expectations.push(wait);
    apply(&mut load, true);
    assert!(load
        .block_reasons
        .iter()
        .all(|reason| reason.owner_type == "task"));
}

fn expectation_under(task: i64) -> Expectation {
    serde_json::from_value(serde_json::json!({
        "id": 50,
        "title": "wait",
        "parent_type": "task",
        "parent_id": task,
        "status": "pending",
        "archival": "live",
        "time_scope": null,
        "position": 0,
        "is_private": false,
        "tag_ids": [],
    }))
    .unwrap()
}

fn find<'forest>(forest: &'forest [FactNode], id: &str) -> Option<&'forest FactNode> {
    forest.iter().find_map(|node| {
        if node.facts.id == id {
            return Some(node);
        }
        find(&node.children, id)
    })
}

#[test]
fn the_filters_read_a_capacity_blocked_task_as_blocked() {
    let mut load = board();
    apply(&mut load, true);

    let forest = facts::forest(&load);

    let blocked = |id: &str| find(&forest, id).unwrap().facts.is_blocked;
    assert!(blocked("task-20"));
    assert!(blocked("task-31"));
    assert!(!blocked("task-23"), "explicitly Not agentic");
    assert!(!blocked("task-40"));
    assert_eq!(find(&forest, "task-20").unwrap().facts.kind, NodeKind::Task);
}

#[test]
fn a_derived_reason_is_marked_on_the_wire_and_a_stored_one_is_not() {
    let mut load = board();
    apply(&mut load, true);
    let wire = serde_json::to_value(&load.block_reasons[0]).unwrap();
    assert_eq!(wire["derived"], "agent_capacity");
    assert_eq!(wire["reason"], AGENT_CAPACITY_REASON);

    let stored = BlockReason {
        owner_type: "task".to_string(),
        owner_id: 1.into(),
        reason: "x".to_string(),
        position: 0,
        derived: None,
        until: None,
    };
    assert!(serde_json::to_value(&stored)
        .unwrap()
        .get("derived")
        .is_none());
}
