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
        id,
        title: format!("goal {id}"),
        parent_type: parent_type.to_string(),
        parent_id,
        status: status.to_string(),
        time_scope: None,
        on_scope_exit: None,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        beads_id: None,
    }
}

fn task_row(id: i64, parent_type: &str, parent_id: i64, status: &str) -> Task {
    Task {
        id,
        title: format!("task {id}"),
        parent_type: parent_type.to_string(),
        parent_id,
        status: status.to_string(),
        delegate_to: None,
        agentic: None,
        asynchronous: false,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        archival: TaskArchival::Live,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        beads_id: None,
    }
}

fn commitment_row(id: i64, parent_type: &str, parent_id: i64, verdict: Verdict) -> Commitment {
    Commitment {
        id,
        title: format!("commitment {id}"),
        parent_type: parent_type.to_string(),
        parent_id,
        verdict,
        time_scope: None,
        verdict_window: None,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        beads_id: None,
    }
}

fn info_row(id: i64, parent_type: &str, parent_id: i64) -> Info {
    Info {
        id,
        body: format!("info {id}"),
        details: None,
        parent_type: parent_type.to_string(),
        parent_id,
        position: id,
        is_private: false,
    }
}

fn lifecycle(node_type: &str, node_id: i64, timing: Timing, archival: Archival) -> ItemLifecycle {
    ItemLifecycle {
        node_type: node_type.to_string(),
        node_id,
        timing,
        resolution: None,
        verdict: None,
        archival,
        archival_conflict: false,
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
        owner_id: 10,
        reason: "waiting".to_string(),
        position: 0,
    });
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 21,
        dependency_type: "task".to_string(),
        dependency_id: 20,
    });
    // A dependency on something already finished does not block.
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 20,
        dependency_type: "task".to_string(),
        dependency_id: 22,
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
fn narrowing_cuts_the_derived_sections_to_match_the_nodes_that_survived() {
    let mut load = board();
    load.block_reasons.push(BlockReason {
        owner_type: "task".to_string(),
        owner_id: 22,
        reason: "waiting".to_string(),
        position: 0,
    });
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 22,
        dependency_type: "goal".to_string(),
        dependency_id: 10,
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
        load.tasks.iter().map(|task| task.id).collect::<Vec<_>>(),
        [20]
    );
    assert_eq!(
        load.domains.iter().map(|domain| domain.id).collect::<Vec<_>>(),
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
        backlogged.tasks.iter().map(|task| task.id).collect::<Vec<_>>(),
        [20, 21]
    );
    assert!(backlogged.commitments.is_empty(), "a Commitment has no Backlog state");
}

#[test]
fn every_parent_spelling_a_row_can_use_resolves_to_a_node() {
    let mut load = board();
    load.domains.push(domain_row(3, "tag", Some(1), None));
    load.domains.push(domain_row(4, "unrecognised", Some(1), None));
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
