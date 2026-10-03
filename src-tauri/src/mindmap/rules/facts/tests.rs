//! The board's facts: what each node inherits, which dependencies block it, its open question,
//! and what the agents are doing.

use super::*;
use crate::{
    domains::model::Domain,
    scopes::key::test_key,
    tasks::model::{Commitment, Goal, Task, TaskArchival, TaskDependencyEdge},
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

fn goal_row(id: i64, parent_type: &str, parent_id: i64, status: &str) -> Goal {
    Goal {
        id: id.into(),
        title: format!("goal {id}"),
        parent_type: parent_type.to_string(),
        parent_id: parent_id.into(),
        status: status.to_string(),
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
        status: Status::from_db(status).expect("a stored status"),
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

fn wait_row(id: i64, task: i64, position: i64, agentic: bool, question: bool) -> Expectation {
    Expectation {
        id: id.into(),
        title: format!("wait {id}"),
        parent_type: "task".to_string(),
        parent_id: task.into(),
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        time_scope: None,
        tag_ids: Vec::new(),
        check_every: None,
        check_starting: None,
        last_check_at: None,
        position,
        is_private: false,
        agentic,
        agentic_note: None,
        question,
        answer: None,
        origin: Default::default(),
    }
}

fn scoped(n: i64) -> TimeScope {
    TimeScope {
        start_id: test_key(n),
        end_id: test_key(n),
        duration: None,
    }
}

fn edge(task: i64, kind: &str, target: i64) -> TaskDependencyEdge {
    TaskDependencyEdge {
        task_id: task.into(),
        dependency_type: kind.to_string(),
        dependency_id: target.into(),
    }
}

/// An Aspect and a Project holding task 10 (Agentic, scoped), with task 11 beneath it, goal 20
/// beneath that, and task 21 beneath the goal; and task 12, explicitly Not agentic, beneath 10.
fn board() -> MindmapLoad {
    let mut ten = task_row(10, "project", 2, "doing", Some(true));
    ten.time_scope = Some(scoped(1));
    MindmapLoad {
        domains: vec![domain_row(1, None), domain_row(2, Some(1))],
        goals: vec![goal_row(20, "task", 11, "active")],
        tasks: vec![
            ten,
            task_row(11, "task", 10, "on_agent", None),
            task_row(21, "goal", 20, "agentic_todo", None),
            task_row(12, "task", 10, "todo", Some(false)),
        ],
        ..MindmapLoad::default()
    }
}

#[test]
fn a_node_inherits_the_nearest_agentic_flag_and_time_scope_above_it() {
    let (facts, _) = derive(&board(), None);
    let inherits = |key: &str| facts.get(key).cloned().unwrap_or_default();
    assert!(inherits("task-11").inherited_agentic);
    assert!(inherits("task-21").inherited_agentic, "through the goal");
    assert!(
        inherits("task-12").inherited_agentic,
        "its own flag is not what it inherits"
    );
    assert!(
        !inherits("task-10").inherited_agentic,
        "nothing above it is flagged"
    );
    assert_eq!(inherits("task-21").inherited_time_scope, Some(scoped(1)));
    assert_eq!(
        inherits("task-10").inherited_time_scope,
        None,
        "its own is not inherited"
    );
}

#[test]
fn a_dependency_blocks_until_its_target_is_finished() {
    let mut load = board();
    load.goals.push(goal_row(30, "project", 2, "achieved"));
    load.task_dependencies = vec![
        edge(11, "task", 12),
        edge(11, "goal", 20),
        edge(11, "goal", 30),
        edge(11, "task", 99),
    ];
    load.short_ids
        .insert("task-12".to_string(), "abc".to_string());
    let (facts, _) = derive(&load, None);
    let blocks = &facts["task-11"].dependency_blocks;
    assert_eq!(
        blocks
            .iter()
            .map(|block| (block.kind.as_str(), block.short_id.as_deref()))
            .collect::<Vec<_>>(),
        vec![("task", Some("abc")), ("goal", None)],
        "an achieved goal and a target not on the board block nothing"
    );
    assert_eq!(blocks[0].title, "task 12");
    assert!(facts["goal-30"].met, "an achieved goal is met");
    assert!(
        !facts.get("task-12").is_some_and(|fact| fact.met),
        "a task not done is not"
    );
}

#[test]
fn the_open_question_is_the_first_live_one_an_agent_raised() {
    let mut load = board();
    load.expectations = vec![
        wait_row(1, 11, 5, true, true),
        wait_row(2, 11, 3, true, true),
        wait_row(3, 11, 1, true, false),
        wait_row(4, 11, 0, false, true),
    ];
    let (facts, activity) = derive(&load, None);
    assert_eq!(facts["task-11"].open_question, Some(2.into()));
    assert_eq!(
        activity.waits, 1,
        "a pending agentic wait that is not a question"
    );
    assert_eq!(activity.on_agent, 1);
    assert_eq!(activity.review, 0);
}

#[test]
fn a_commitment_expires_unresolved_and_archived() {
    let mut load = board();
    let commitment = |id: i64, verdict: Verdict| Commitment {
        id: id.into(),
        title: format!("commitment {id}"),
        parent_type: "project".to_string(),
        parent_id: 2.into(),
        verdict,
        time_scope: None,
        verdict_window: None,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        origin: Default::default(),
    };
    load.commitments = vec![
        commitment(40, Verdict::Unresolved),
        commitment(41, Verdict::Kept),
    ];
    let archived = |id: i64| ItemLifecycle {
        node_type: "commitment".to_string(),
        node_id: id.into(),
        timing: crate::tasks::lifecycle::Timing::Lapsed,
        resolution: None,
        overdue: false,
        verdict: None,
        archival: Archival::Archived,
        archival_conflict: false,
        plan_timing: None,
    };
    load.lifecycles = vec![archived(40), archived(41)];
    let (facts, _) = derive(&load, None);
    assert!(facts["commitment-40"].expired);
    assert!(!facts.get("commitment-41").is_some_and(|fact| fact.expired));
}

#[test]
fn a_node_is_seen_through_its_root_and_a_derived_one_through_its_nearest_stored_ancestor() {
    use crate::access::model::{EffectiveAccess, NodeTable};
    use crate::nodes::id::DerivedId;
    let mut load = board();
    let mut occurrence = task_row(0, "task", 10, "todo", None);
    occurrence.id = NodeId::Derived(DerivedId::of_key("habit:1"));
    let occurrence_key = format!("task-{}", occurrence.id);
    load.tasks.push(occurrence);
    let seen = |table: NodeTable, id: i64| EffectiveAccess {
        node_kind: table,
        node_id: id,
        root_kind: NodeTable::Domain,
        root_id: 2,
    };
    let access = [seen(NodeTable::Domain, 2), seen(NodeTable::Task, 10)];
    let (facts, _) = derive(&load, Some(&access));
    let via = |key: &str| facts.get(key).and_then(|fact| fact.mcp_visible_via.clone());
    assert_eq!(via("task-10").as_deref(), Some("domain 2"));
    assert_eq!(
        via(&occurrence_key).as_deref(),
        Some("domain 2"),
        "through task 10"
    );
    assert_eq!(via("task-11"), None, "a stored node the roots do not reach");
}

#[test]
fn a_derived_wait_says_what_it_may_not_be_done_to_and_a_row_made_by_hand_says_nothing() {
    use crate::nodes::origin::{CheckOrigin, Origin};
    let mut load = board();
    let mut check = task_row(30, "expectation", 3, "todo", None);
    check.origin = Origin::Check(CheckOrigin {
        wait_kind: crate::tasks::waits::WaitKind::Stored,
        wait_id: 3.into(),
        due_at: chrono::NaiveDateTime::default(),
    });
    load.tasks.push(check);
    let (facts, _) = derive(&load, None);
    let capabilities = facts.get("task-30").and_then(|node| node.capabilities);
    assert!(capabilities.is_some_and(|can| !can.delete && !can.drag && !can.compound));
    assert_eq!(
        facts.get("task-12").and_then(|node| node.capabilities),
        None,
        "a row made by hand carries no limits"
    );
}
