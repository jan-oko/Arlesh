//! Assembling a fact forest from a load, and narrowing a load to what a filter keeps.

use super::*;
use crate::{
    block_reasons::model::BlockReason,
    domains::model::Domain,
    filters::model::{NodeKind, Preset},
    infos::model::Info,
    tasks::{
        lifecycle::{ItemLifecycle, Timing},
        model::{Commitment, Goal, Task, TaskDependencyEdge, Verdict},
    },
};

fn domain_row(id: i64, subtype: &str, parent: Option<i64>, status: Option<&str>) -> Domain {
    Domain {
        id,
        title: format!("domain {id}"),
        description: None,
        subtype: subtype.to_string(),
        parent_id: parent,
        color: None,
        status: status.map(str::to_string),
        knowledge_base_directory: None,
        position: id,
        is_private: false,
        beads_id: None,
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
        beads_id: None,
        origin: Default::default(),
    }
}

fn task_row(id: i64, parent_type: &str, parent_id: i64, status: &str) -> Task {
    Task {
        id: id.into(),
        title: format!("task {id}"),
        parent_type: parent_type.to_string(),
        parent_id: parent_id.into(),
        status: status.to_string(),
        delegate_to: None,
        agentic: None,
        asynchronous: false,
        async_template: None,
        agentic_brief: None,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        archival: TaskArchival::Live,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        beads_id: None,
        origin: Default::default(),
    }
}

fn commitment_row(id: i64, parent_type: &str, parent_id: i64, verdict: Verdict) -> Commitment {
    Commitment {
        id: id.into(),
        title: format!("commitment {id}"),
        parent_type: parent_type.to_string(),
        parent_id: parent_id.into(),
        verdict,
        time_scope: None,
        verdict_window: None,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        beads_id: None,
        origin: Default::default(),
    }
}

fn info_row(id: i64, parent_type: &str, parent_id: i64) -> Info {
    Info {
        id,
        body: format!("info {id}"),
        details: None,
        parent_type: parent_type.to_string(),
        parent_id: parent_id.into(),
        position: id,
        is_private: false,
    }
}

fn lifecycle(node_type: &str, node_id: i64, timing: Timing, archival: Archival) -> ItemLifecycle {
    ItemLifecycle {
        node_type: node_type.to_string(),
        node_id: node_id.into(),
        timing,
        resolution: None,
        verdict: None,
        archival,
        archival_conflict: false,
        plan_timing: None,
    }
}

/// A small board: one Aspect, one Project, one Goal, three Tasks, a Commitment and a note.
fn board() -> MindmapLoad {
    MindmapLoad {
        domains: vec![
            domain_row(1, "aspect", None, None),
            domain_row(2, "project", Some(1), Some("active")),
        ],
        goals: vec![goal_row(10, "domain", 2, "active")],
        tasks: vec![
            task_row(20, "goal", 10, "in_progress"),
            task_row(21, "task", 20, "todo"),
            task_row(22, "goal", 10, "done"),
        ],
        commitments: vec![commitment_row(30, "goal", 10, Verdict::Unresolved)],
        infos: vec![info_row(40, "task", 22)],
        ..MindmapLoad::default()
    }
}

fn ids(forest: &[FactNode]) -> Vec<String> {
    tree::kept_ids_in_forest(forest).into_iter().collect()
}

#[test]
fn the_forest_follows_the_rows_own_parent_links() {
    let forest = forest(&board());
    assert_eq!(forest.len(), 1);
    assert_eq!(forest[0].facts.id, "domain-1");
    assert_eq!(
        ids(&forest),
        [
            "commitment-30",
            "domain-1",
            "domain-2",
            "goal-10",
            "info-40",
            "task-20",
            "task-21",
            "task-22",
        ]
    );
}

#[test]
fn an_in_progress_task_with_a_todo_child_says_so() {
    let forest = forest(&board());
    let task_20 = find(&forest, "task-20").expect("the task is on the board");
    assert!(task_20.facts.has_todo_child);
    let task_22 = find(&forest, "task-22").expect("the task is on the board");
    assert!(!task_22.facts.has_todo_child);
}

fn find<'a>(forest: &'a [FactNode], id: &str) -> Option<&'a FactNode> {
    for node in forest {
        if node.facts.id == id {
            return Some(node);
        }
        if let Some(found) = find(&node.children, id) {
            return Some(found);
        }
    }
    None
}

#[test]
fn an_orphan_row_is_dropped_rather_than_promoted_to_a_root() {
    let mut load = board();
    load.tasks.push(task_row(99, "goal", 404, "todo"));
    let forest = forest(&load);
    assert!(find(&forest, "task-99").is_none());
    assert_eq!(forest.len(), 1);
}

#[test]
fn an_explicit_block_reason_and_an_unmet_dependency_both_read_as_blocked() {
    let mut load = board();
    load.block_reasons.push(BlockReason {
        owner_type: "goal".to_string(),
        owner_id: 10.into(),
        reason: "waiting".to_string(),
        position: 0,
    });
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 21.into(),
        dependency_type: "task".to_string(),
        dependency_id: 20.into(),
    });
    // A dependency on something already finished does not block.
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 20.into(),
        dependency_type: "task".to_string(),
        dependency_id: 22.into(),
    });

    let forest = forest(&load);
    assert!(find(&forest, "goal-10").is_some_and(|node| node.facts.is_blocked));
    assert!(find(&forest, "task-21").is_some_and(|node| node.facts.is_blocked));
    assert!(find(&forest, "task-20").is_some_and(|node| !node.facts.is_blocked));
}

#[test]
fn a_lifecycle_supplies_the_two_derived_facts_a_filter_reads() {
    let mut load = board();
    load.lifecycles
        .push(lifecycle("task", 22, Timing::Lapsed, Archival::Archived));
    let forest = forest(&load);
    let task_22 = find(&forest, "task-22").expect("the task is on the board");
    assert_eq!(task_22.facts.timing, Some(Timing::Lapsed));
    assert!(task_22.facts.archived);
    // An item the derivation skipped keeps its neutral values.
    let task_21 = find(&forest, "task-21").expect("the task is on the board");
    assert_eq!(task_21.facts.timing, None);
    assert!(!task_21.facts.archived);
}

#[test]
fn a_lifecycle_supplies_the_task_plan_position_too() {
    let mut load = board();
    let mut planned = lifecycle("task", 22, Timing::Active, Archival::Live);
    planned.plan_timing = Some(Timing::Pending);
    load.lifecycles.push(planned);
    load.lifecycles
        .push(lifecycle("task", 21, Timing::Active, Archival::Live));
    let forest = forest(&load);
    let task_22 = find(&forest, "task-22").expect("the task is on the board");
    assert_eq!(task_22.facts.plan_timing, Some(Timing::Pending));
    let task_21 = find(&forest, "task-21").expect("the task is on the board");
    assert_eq!(task_21.facts.plan_timing, None);
}

#[test]
fn narrowing_cuts_the_derived_sections_to_match_the_nodes_that_survived() {
    let mut load = board();
    load.block_reasons.push(BlockReason {
        owner_type: "task".to_string(),
        owner_id: 22.into(),
        reason: "waiting".to_string(),
        position: 0,
    });
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 22.into(),
        dependency_type: "goal".to_string(),
        dependency_id: 10.into(),
    });
    load.lifecycles
        .push(lifecycle("task", 22, Timing::Active, Archival::Live));

    narrow(&mut load, &BoardFilter::preset(Preset::Plan));

    // The done task is gone, and so is everything the payload said about it.
    assert!(load.tasks.iter().all(|task| task.id != 22));
    assert!(load.infos.is_empty(), "the note under it went with it");
    assert!(load.lifecycles.is_empty());
    assert!(load.block_reasons.is_empty());
    assert!(load.task_dependencies.is_empty());
    // What is still live is untouched.
    assert_eq!(load.tasks.len(), 2);
    assert_eq!(load.domains.len(), 2);
    assert_eq!(load.commitments.len(), 1);
}

#[test]
fn narrowing_to_do_keeps_the_containers_that_carry_an_in_progress_task() {
    let mut load = board();
    narrow(&mut load, &BoardFilter::preset(Preset::Do));
    assert_eq!(
        load.tasks
            .iter()
            .map(|task| task.id.clone())
            .collect::<Vec<_>>(),
        [20]
    );
    assert_eq!(
        load.domains
            .iter()
            .map(|domain| domain.id)
            .collect::<Vec<_>>(),
        [1, 2]
    );
    assert_eq!(load.goals.len(), 1);
}

#[test]
fn a_backlogged_task_leaves_plan_and_comes_back_under_the_backlog_preset() {
    let mut load = board();
    if let Some(task) = load.tasks.iter_mut().find(|task| task.id == 21) {
        task.archival = TaskArchival::Backlog;
    }

    let mut planned = load.clone();
    narrow(&mut planned, &BoardFilter::preset(Preset::Plan));
    assert!(planned.tasks.iter().all(|task| task.id != 21));

    // Task 20 is task 21's parent: it does not match Backlog itself, and comes back only as the
    // ancestor that reaches what does.
    let mut backlogged = load;
    narrow(&mut backlogged, &BoardFilter::preset(Preset::Backlog));
    assert_eq!(
        backlogged
            .tasks
            .iter()
            .map(|task| task.id.clone())
            .collect::<Vec<_>>(),
        [20, 21]
    );
    assert!(
        backlogged.commitments.is_empty(),
        "a Commitment has no Backlog state"
    );
}

#[test]
fn every_parent_spelling_a_row_can_use_resolves_to_a_node() {
    let mut load = board();
    load.domains.push(domain_row(3, "tag", Some(1), None));
    load.domains
        .push(domain_row(4, "unrecognised", Some(1), None));
    load.commitments
        .push(commitment_row(31, "task", 21, Verdict::Kept));
    load.infos.push(info_row(41, "info", 40));
    load.infos.push(info_row(42, "commitment", 30));
    load.infos.push(info_row(43, "domain", 2));

    let forest = forest(&load);
    assert!(find(&forest, "domain-3").is_some_and(|node| node.facts.kind == NodeKind::Tag));
    assert!(find(&forest, "domain-4").is_some_and(|node| node.facts.kind == NodeKind::Domain));
    for id in ["commitment-31", "info-41", "info-42", "info-43"] {
        assert!(find(&forest, id).is_some(), "{id} found its parent");
    }
}

fn expectation_row(id: i64, parent_type: &str, parent_id: i64) -> crate::tasks::model::Expectation {
    crate::tasks::model::Expectation {
        id: id.into(),
        title: format!("expectation {id}"),
        parent_type: parent_type.to_string(),
        parent_id: parent_id.into(),
        status: crate::tasks::model::ExpectationStatus::Pending,
        archival: crate::tasks::model::ExpectationArchival::Live,
        check_every: None,
        check_starting: None,
        last_check_at: None,
        time_scope: None,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        agentic: false,
        agentic_note: None,
        question: false,
        answer: None,
        origin: Default::default(),
    }
}

/// A wait's check task as the Task virtual table serves it: a row under its wait.
fn check_row(id: &str, wait: i64, status: &str) -> Task {
    Task {
        id: NodeId::Derived(crate::nodes::id::DerivedId::of_key(id)),
        parent_type: "expectation".to_string(),
        parent_id: wait.into(),
        ..task_row(0, "expectation", wait, status)
    }
}

#[test]
fn a_check_task_row_hangs_under_its_wait_timed_by_its_own_lifecycle() {
    let mut load = board();
    let mut checked = expectation_row(50, "goal", 10);
    checked.check_every = Some(crate::tasks::model::DurationSpec {
        n: 3,
        kind: "day".to_string(),
    });
    load.expectations.push(checked);
    let check = check_row("check:stored:50@2026-07-04T02:00:00", 50, "todo");
    let check_fact = format!("task-{}", check.id);
    load.lifecycles.push(ItemLifecycle {
        node_id: check.id.clone(),
        ..lifecycle("task", 0, Timing::Pending, Archival::Live)
    });
    load.tasks.push(check);
    load.lifecycles
        .push(lifecycle("expectation", 50, Timing::Lapsed, Archival::Live));

    let forest = forest(&load);
    let wait = find(&forest, "expectation-50").expect("the expectation is on the board");
    assert!(wait.facts.has_check);
    assert_eq!(wait.facts.timing, Some(Timing::Lapsed));
    let check = find(&forest, &check_fact).expect("the check task is a row");
    assert_eq!(check.facts.kind, NodeKind::Task);
    assert_eq!(check.facts.timing, Some(Timing::Pending));
}

#[test]
fn a_released_expectation_stops_blocking() {
    let mut load = board();
    let mut released = expectation_row(50, "goal", 10);
    released.status = crate::tasks::model::ExpectationStatus::Released;
    load.expectations.push(released);
    load.expectations.push(expectation_row(51, "goal", 10));
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 21.into(),
        dependency_type: "expectation".to_string(),
        dependency_id: 50.into(),
    });
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 22.into(),
        dependency_type: "expectation".to_string(),
        dependency_id: 51.into(),
    });
    let forest = forest(&load);
    assert!(find(&forest, "task-21").is_some_and(|node| !node.facts.is_blocked));
    assert!(find(&forest, "task-22").is_some_and(|node| node.facts.is_blocked));
}

#[test]
fn a_derived_wait_row_hangs_under_its_task() {
    let mut load = board();
    let key = crate::nodes::key::DerivedKey::DelegationWait(20.into());
    load.expectations.push(crate::tasks::model::Expectation {
        id: key.node_id(),
        origin: crate::nodes::origin::Origin::DelegationWait(crate::nodes::origin::WaitOrigin {
            task_id: 20.into(),
        }),
        ..expectation_row(0, "task", 20)
    });
    let forest = forest(&load);
    let wait = find(&forest, &format!("expectation-{}", key.node_id()))
        .expect("the delegation wait is a row");
    assert_eq!(wait.facts.kind, NodeKind::Expectation);
    assert_eq!(wait.facts.status.as_deref(), Some("pending"));
}

#[test]
fn narrowing_keeps_an_expectation_the_filter_keeps_and_drops_one_it_does_not() {
    let mut load = board();
    load.expectations.push(expectation_row(50, "goal", 10));
    let mut released = expectation_row(51, "goal", 10);
    released.status = crate::tasks::model::ExpectationStatus::Released;
    load.expectations.push(released);
    narrow(&mut load, &BoardFilter::preset(Preset::Plan));
    let kept: Vec<NodeId> = load.expectations.iter().map(|e| e.id.clone()).collect();
    assert_eq!(kept, [NodeId::Stored(50)]);
}

#[test]
fn a_done_check_task_is_dropped_by_the_presets_that_hide_done_work() {
    let mut load = board();
    load.expectations.push(expectation_row(50, "goal", 10));
    let done = check_row("check:stored:50@2026-07-01T02:00:00", 50, "done");
    let done_fact = format!("task-{}", done.id);
    load.tasks.push(done);
    let forest = forest(&load);
    let check = find(&forest, &done_fact).expect("the done check stays on the board");
    assert_eq!(check.facts.status.as_deref(), Some("done"));
}
