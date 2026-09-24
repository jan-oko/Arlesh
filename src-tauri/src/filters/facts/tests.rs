//! Assembling a fact forest from a load, and narrowing a load to what a filter keeps.

use super::*;
use crate::scopes::key::test_key;
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
            .map(|task| task.id)
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
        id,
        title: format!("expectation {id}"),
        parent_type: parent_type.to_string(),
        parent_id,
        status: crate::tasks::model::ExpectationStatus::Pending,
        archival: crate::tasks::model::ExpectationArchival::Live,
        check_every: None,
        check_starting: None,
        last_check_at: None,
        time_scope: None,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
    }
}

#[test]
fn an_expectation_with_a_check_due_carries_a_virtual_check_task_timed_by_its_lifecycle() {
    let mut load = board();
    let mut checked = expectation_row(50, "goal", 10);
    checked.check_every = Some(crate::tasks::model::DurationSpec {
        n: 3,
        kind: "day".to_string(),
    });
    load.expectations.push(checked);
    load.expectation_checks
        .push(crate::tasks::waits::ExpectationCheck {
            expectation_id: 50,
            due: crate::tasks::model::TimeScope {
                start_id: test_key(1),
                end_id: test_key(1),
                duration: None,
            },
            due_at: instant(2026, 7, 4),
            resolved_at: None,
        });
    load.expectations.push(expectation_row(51, "goal", 10));
    load.infos.push(info_row(41, "expectation", 51));
    load.lifecycles.push(lifecycle(
        "expectation_check",
        50,
        Timing::Pending,
        Archival::Live,
    ));
    load.lifecycles
        .push(lifecycle("expectation", 50, Timing::Lapsed, Archival::Live));

    let forest = forest(&load);
    let wait = find(&forest, "expectation-50").expect("the expectation is on the board");
    assert!(wait.facts.has_check);
    assert_eq!(wait.facts.timing, Some(Timing::Lapsed));
    assert_eq!(wait.facts.status.as_deref(), Some("pending"));
    let check = find(&forest, "expectation-check-50").expect("the check task is derived");
    assert_eq!(check.facts.kind, NodeKind::Task);
    assert_eq!(check.facts.timing, Some(Timing::Pending));
    assert!(find(&forest, "expectation-check-51").is_none());
    assert!(find(&forest, "info-41").is_some());
}

#[test]
fn a_released_expectation_has_no_check_task_and_stops_blocking() {
    let mut load = board();
    let mut released = expectation_row(50, "goal", 10);
    released.status = crate::tasks::model::ExpectationStatus::Released;
    load.expectations.push(released);
    load.expectations.push(expectation_row(51, "goal", 10));
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 21,
        dependency_type: "expectation".to_string(),
        dependency_id: 50,
    });
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 22,
        dependency_type: "expectation".to_string(),
        dependency_id: 51,
    });
    let forest = forest(&load);
    assert!(find(&forest, "expectation-check-50").is_none());
    assert!(find(&forest, "task-21").is_some_and(|node| !node.facts.is_blocked));
    assert!(find(&forest, "task-22").is_some_and(|node| node.facts.is_blocked));
}

#[test]
fn a_delegated_task_is_delegated_and_waits_on_a_virtual_expectation_until_done() {
    let mut load = board();
    for task in &mut load.tasks {
        task.delegate_to = Some(crate::tasks::model::Delegate::Agent);
    }
    let forest = forest(&load);
    assert!(find(&forest, "task-20").is_some_and(|node| node.facts.delegated));
    let wait = find(&forest, "delegation-wait-20").expect("an undone delegated task waits");
    assert_eq!(wait.facts.kind, NodeKind::Expectation);
    assert!(
        find(&forest, "delegation-wait-22").is_none(),
        "task 22 is done"
    );
}

#[test]
fn narrowing_keeps_an_expectation_the_filter_keeps_and_drops_one_it_does_not() {
    let mut load = board();
    load.expectations.push(expectation_row(50, "goal", 10));
    let mut released = expectation_row(51, "goal", 10);
    released.status = crate::tasks::model::ExpectationStatus::Released;
    load.expectations.push(released);
    narrow(&mut load, &BoardFilter::preset(Preset::Plan));
    let kept: Vec<i64> = load.expectations.iter().map(|e| e.id).collect();
    assert_eq!(kept, [50]);
}

fn spawned(
    task_id: i64,
    status: crate::tasks::model::ExpectationStatus,
) -> crate::tasks::waits::SpawnedWaitView {
    crate::tasks::waits::SpawnedWaitView {
        wait: crate::tasks::model::SpawnedWait {
            task_id,
            spawned_at: chrono::NaiveDate::from_ymd_opt(2026, 7, 1)
                .and_then(|date| date.and_hms_opt(9, 0, 0)),
            status,
            archival: crate::tasks::model::ExpectationArchival::Live,
            last_check_at: None,
        },
        time_scope: None,
        next_check: Some(crate::tasks::model::TimeScope {
            start_id: test_key(1),
            end_id: test_key(1),
            duration: None,
        }),
        next_check_at: Some(instant(2026, 7, 8)),
        done_checks: vec![],
    }
}

fn instant(year: i32, month: u32, day: u32) -> chrono::NaiveDateTime {
    chrono::NaiveDate::from_ymd_opt(year, month, day)
        .and_then(|date| date.and_hms_opt(2, 0, 0))
        .expect("a date")
}

#[test]
fn a_completed_check_stays_as_a_done_task_the_done_hiding_presets_drop() {
    let mut load = board();
    let mut checked = expectation_row(50, "goal", 10);
    checked.check_every = Some(crate::tasks::model::DurationSpec {
        n: 3,
        kind: "day".to_string(),
    });
    load.expectations.push(checked);
    let scope = crate::tasks::model::TimeScope {
        start_id: test_key(1),
        end_id: test_key(1),
        duration: None,
    };
    load.expectation_checks
        .push(crate::tasks::waits::ExpectationCheck {
            expectation_id: 50,
            due: scope.clone(),
            due_at: instant(2026, 7, 1),
            resolved_at: Some(instant(2026, 7, 2)),
        });
    let mut spawned_wait = spawned(22, crate::tasks::model::ExpectationStatus::Pending);
    spawned_wait
        .done_checks
        .push(crate::tasks::waits::DoneCheck {
            due: scope,
            due_at: instant(2026, 7, 8),
            resolved_at: instant(2026, 7, 8),
        });
    for task in &mut load.tasks {
        if task.id == 22 {
            task.asynchronous = true;
            task.async_template = Some(crate::tasks::model::AsyncTemplate {
                title: "Reply".to_string(),
                ..Default::default()
            });
        }
    }
    load.spawned_waits.push(spawned_wait);
    let forest = forest(&load);
    for id in [
        "expectation-check-50-2026-07-01 02:00:00",
        "spawned-check-22-2026-07-08 02:00:00",
    ] {
        let check = find(&forest, id).expect("the done check stays on the board");
        assert_eq!(check.facts.kind, NodeKind::Task);
        assert_eq!(check.facts.status.as_deref(), Some("done"));
    }
    assert!(
        find(&forest, "expectation-check-50").is_none(),
        "no check is due, so none is open"
    );
}

#[test]
fn a_done_asynchronous_task_carries_its_spawned_wait_and_does_not_hold_up_its_dependents() {
    let mut load = board();
    for task in &mut load.tasks {
        if task.id == 22 {
            task.asynchronous = true;
            task.async_template = Some(crate::tasks::model::AsyncTemplate {
                title: "Reply".to_string(),
                tag_ids: vec![7],
                time_scope: None,
                check_every: Some(crate::tasks::model::DurationSpec {
                    n: 1,
                    kind: "week".to_string(),
                }),
            });
        }
    }
    load.spawned_waits
        .push(spawned(22, crate::tasks::model::ExpectationStatus::Pending));
    load.task_dependencies.push(TaskDependencyEdge {
        task_id: 21,
        dependency_type: "task".to_string(),
        dependency_id: 22,
    });
    let pending = forest(&load);
    let wait = find(&pending, "spawned-wait-22").expect("the spawned wait is drawn");
    assert_eq!(wait.facts.kind, NodeKind::Expectation);
    assert_eq!(wait.facts.tag_ids, [7]);
    assert!(wait.facts.has_check);
    assert!(find(&pending, "spawned-check-22").is_some());
    assert!(
        find(&pending, "task-21").is_some_and(|node| !node.facts.is_blocked),
        "task 22 is done: a pending spawned wait does not hold up its dependents"
    );

    let mut untemplated = load;
    for task in &mut untemplated.tasks {
        task.async_template = None;
    }
    let bare = forest(&untemplated);
    assert!(find(&bare, "spawned-wait-22").is_none());
    assert!(find(&bare, "task-21").is_some_and(|node| !node.facts.is_blocked));
}
