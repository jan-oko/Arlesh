//! What a Task may depend on, ported from `src/utils/dependency-candidates.test.ts` as its
//! specification.

use super::*;
use crate::{
    nodes::{id::DerivedId, origin::CheckOrigin},
    tasks::{
        model::{ExpectationArchival, ExpectationStatus, Status, TaskArchival, TaskStatus},
        waits::WaitKind,
    },
};

fn task(id: NodeId, origin: Origin) -> Task {
    Task {
        id,
        title: "task".to_string(),
        parent_type: "domain".to_string(),
        parent_id: 1.into(),
        status: Status::Ordinary(TaskStatus::Todo),
        delegate_to: None,
        agentic: None,
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
        position: 0,
        is_private: false,
        origin,
    }
}

fn goal(id: i64) -> Goal {
    Goal {
        id: id.into(),
        title: "goal".to_string(),
        parent_type: "domain".to_string(),
        parent_id: 1.into(),
        status: "active".to_string(),
        time_scope: None,
        on_scope_exit: None,
        tag_ids: Vec::new(),
        position: 0,
        is_private: false,
        origin: Origin::Manual,
    }
}

fn wait(id: NodeId) -> Expectation {
    Expectation {
        id,
        title: "wait".to_string(),
        parent_type: "domain".to_string(),
        parent_id: 1.into(),
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        time_scope: None,
        tag_ids: Vec::new(),
        check_every: None,
        check_starting: None,
        last_check_at: None,
        position: 0,
        is_private: false,
        agentic: false,
        agentic_note: None,
        question: false,
        answer: None,
        origin: Origin::Manual,
    }
}

fn check() -> Origin {
    Origin::Check(CheckOrigin {
        wait_kind: WaitKind::Stored,
        wait_id: 7.into(),
        due_at: chrono::NaiveDate::from_ymd_opt(2026, 1, 5)
            .and_then(|date| date.and_hms_opt(2, 0, 0))
            .unwrap_or_default(),
    })
}

fn edge(task: i64, kind: &str, target: i64) -> TaskDependencyEdge {
    TaskDependencyEdge {
        task_id: task.into(),
        dependency_type: kind.to_string(),
        dependency_id: target.into(),
    }
}

fn keys(dependencies: &[Dependency]) -> Vec<String> {
    dependencies.iter().map(key_of).collect()
}

/// Tasks 1–4, a check task, Goal 10, stored wait 20 and a derived wait.
fn board() -> (Vec<Task>, Vec<Goal>, Vec<Expectation>) {
    let derived = NodeId::Derived(DerivedId::of_key("wait:spawned:3"));
    (
        vec![
            task(1.into(), Origin::Manual),
            task(2.into(), Origin::Manual),
            task(3.into(), Origin::Manual),
            task(4.into(), Origin::Manual),
            task(NodeId::Derived(DerivedId::of_key("check:7")), check()),
        ],
        vec![goal(10)],
        vec![wait(20.into()), wait(derived)],
    )
}

#[test]
fn a_stored_task_and_an_occurrence_hold_dependencies_and_a_check_task_does_not() {
    assert!(holds_dependencies(&Origin::Manual));
    assert!(!holds_dependencies(&check()));
}

#[test]
fn every_goal_every_other_task_and_every_stored_wait_is_offered() {
    let (tasks, goals, waits) = board();
    assert_eq!(
        keys(&candidates(&1.into(), &tasks, &goals, &waits, &[])),
        ["task-2", "task-3", "task-4", "goal-10", "expectation-20"]
    );
}

#[test]
fn what_it_already_depends_on_is_left_out() {
    let (tasks, goals, waits) = board();
    let edges = [edge(1, "task", 2), edge(1, "goal", 10)];
    assert_eq!(
        keys(&candidates(&1.into(), &tasks, &goals, &waits, &edges)),
        ["task-3", "task-4", "expectation-20"]
    );
}

#[test]
fn every_task_that_depends_on_it_through_a_chain_is_left_out() {
    let (tasks, goals, waits) = board();
    // 3 depends on 2, which depends on 1: either pick would close a cycle.
    let edges = [edge(2, "task", 1), edge(3, "task", 2)];
    assert_eq!(
        keys(&candidates(&1.into(), &tasks, &goals, &waits, &edges)),
        ["task-4", "goal-10", "expectation-20"]
    );
}

#[test]
fn a_task_sharing_a_goal_or_a_wait_is_still_offered() {
    let (tasks, goals, waits) = board();
    let edges = [edge(2, "goal", 10), edge(2, "expectation", 20)];
    assert_eq!(
        keys(&candidates(&1.into(), &tasks, &goals, &waits, &edges)),
        ["task-2", "task-3", "task-4", "goal-10", "expectation-20"]
    );
}
