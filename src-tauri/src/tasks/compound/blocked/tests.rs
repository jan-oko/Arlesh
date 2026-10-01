//! A Compound Task blocked when every one of its open counted items is.

use super::*;
use crate::tasks::{
    compound::tests::{commitment, compound, goal, task, wait, Board},
    model::{ExpectationStatus, Task, Verdict},
};

use crate::tasks::model::TaskStatus::{Done, InProgress, Started, Todo};

fn reason(owner_type: &str, id: i64) -> BlockReason {
    BlockReason {
        owner_type: owner_type.to_string(),
        owner_id: id.into(),
        reason: "waiting".to_string(),
        position: 0,
        derived: None,
        until: None,
    }
}

fn edge(task_id: i64, dependency_type: &str, dependency_id: i64) -> TaskDependencyEdge {
    TaskDependencyEdge {
        task_id: task_id.into(),
        dependency_type: dependency_type.to_string(),
        dependency_id: dependency_id.into(),
    }
}

/// A Compound Task as the board serves it: its status already derived.
fn served(id: i64, parent: (&str, i64), status: TaskStatus) -> Task {
    Task {
        status: status.as_str().to_string(),
        ..compound(id, parent)
    }
}

fn blocked(board: &Board, reasons: &[BlockReason], edges: &[TaskDependencyEdge]) -> Vec<NodeId> {
    derive(
        &Rows {
            tasks: &board.tasks,
            checks: &board.checks,
            goals: &board.goals,
            commitments: &board.commitments,
            expectations: &board.expectations,
            waits: &board.waits,
            lifecycles: &board.lifecycles,
            wait_lifecycles: &[],
        },
        reasons,
        edges,
    )
    .into_iter()
    .inspect(|reason| {
        assert_eq!(reason.derived, Some(DerivedBlock::Compound));
        assert_eq!(reason.reason, REASON);
    })
    .map(|reason| reason.owner_id)
    .collect()
}

#[test]
fn every_open_item_blocked_blocks_the_compound() {
    let board = Board {
        tasks: vec![
            served(1, ("project", 100), Todo),
            task(2, ("task", 1), Todo),
            task(3, ("task", 1), Todo),
            task(4, ("task", 1), Done),
            task(5, ("project", 100), InProgress),
        ],
        ..Board::default()
    };
    // One by a reason, one by a dependency on an unfinished task; the done one is not open.
    let found = blocked(&board, &[reason("task", 2)], &[edge(3, "task", 5)]);
    assert_eq!(found, vec![NodeId::Stored(1)]);
}

#[test]
fn one_open_item_free_leaves_it_unblocked() {
    let board = Board {
        tasks: vec![
            served(1, ("project", 100), Todo),
            task(2, ("task", 1), Todo),
            task(3, ("task", 1), Todo),
        ],
        ..Board::default()
    };
    assert!(blocked(&board, &[reason("task", 2)], &[]).is_empty());
}

#[test]
fn no_open_item_is_nothing_to_be_blocked_by() {
    let all_done = Board {
        tasks: vec![
            served(1, ("project", 100), Done),
            task(2, ("task", 1), Done),
        ],
        ..Board::default()
    };
    assert!(blocked(&all_done, &[reason("task", 2)], &[]).is_empty());
    let empty = Board {
        tasks: vec![served(1, ("project", 100), Todo)],
        ..Board::default()
    };
    assert!(blocked(&empty, &[], &[]).is_empty());
}

#[test]
fn a_pending_wait_or_an_unresolved_commitment_is_open_and_never_blocked() {
    let with_wait = Board {
        tasks: vec![
            served(1, ("project", 100), Started),
            task(2, ("task", 1), Todo),
        ],
        expectations: vec![wait(3, ("task", 1), ExpectationStatus::Pending)],
        ..Board::default()
    };
    assert!(blocked(&with_wait, &[reason("task", 2)], &[]).is_empty());
    let with_commitment = Board {
        tasks: vec![
            served(1, ("project", 100), Started),
            task(2, ("task", 1), Todo),
        ],
        commitments: vec![commitment(3, ("task", 1), Verdict::Unresolved)],
        ..Board::default()
    };
    assert!(blocked(&with_commitment, &[reason("task", 2)], &[]).is_empty());
    // Released and resolved, they are Done: not open, so they hold nothing up.
    let settled = Board {
        tasks: vec![
            served(1, ("project", 100), Started),
            task(2, ("task", 1), Todo),
        ],
        expectations: vec![wait(3, ("task", 1), ExpectationStatus::Released)],
        commitments: vec![commitment(4, ("task", 1), Verdict::Kept)],
        ..Board::default()
    };
    assert_eq!(
        blocked(&settled, &[reason("task", 2)], &[]),
        vec![NodeId::Stored(1)]
    );
}

#[test]
fn an_open_goal_counts_by_its_own_block_and_an_achieved_one_is_done() {
    let board = Board {
        tasks: vec![served(1, ("project", 100), Todo)],
        goals: vec![
            goal(2, ("task", 1), "active"),
            goal(3, ("task", 1), "achieved"),
        ],
        ..Board::default()
    };
    assert_eq!(
        blocked(&board, &[reason("goal", 2)], &[]),
        vec![NodeId::Stored(1)]
    );
    assert!(blocked(&board, &[], &[]).is_empty());
}

#[test]
fn a_compound_inside_counts_by_its_own_derived_block() {
    let board = Board {
        tasks: vec![
            served(1, ("project", 100), Todo),
            served(2, ("task", 1), Todo),
            task(3, ("task", 2), Todo),
        ],
        ..Board::default()
    };
    let mut found = blocked(&board, &[reason("task", 3)], &[]);
    found.sort();
    assert_eq!(found, vec![NodeId::Stored(1), NodeId::Stored(2)]);
}

#[test]
fn a_parent_loop_ends() {
    let board = Board {
        tasks: vec![served(1, ("task", 2), Todo), served(2, ("task", 1), Todo)],
        ..Board::default()
    };
    assert!(blocked(&board, &[], &[]).len() <= 2);
}
