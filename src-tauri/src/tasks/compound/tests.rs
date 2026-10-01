//! The progress rule, and deriving compound Tasks' statuses over a board.

use super::*;
use crate::{
    nodes::origin::WaitOrigin,
    tasks::{
        lifecycle::Timing,
        model::{Delegate, TaskArchival},
    },
};

use crate::tasks::model::TaskStatus::{Done, InProgress, Started, Todo};

fn at(hour: u32) -> NaiveDateTime {
    chrono::NaiveDate::from_ymd_opt(2026, 9, 30)
        .and_then(|day| day.and_hms_opt(hour, 0, 0))
        .unwrap()
}

fn task(id: i64, parent: (&str, i64), status: TaskStatus) -> Task {
    Task {
        id: id.into(),
        title: format!("task {id}"),
        parent_type: parent.0.to_string(),
        parent_id: parent.1.into(),
        status: status.as_str().to_string(),
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
        position: id,
        is_private: false,
        beads_id: None,
        origin: Origin::Manual,
    }
}

fn compound(id: i64, parent: (&str, i64)) -> Task {
    Task {
        compound: true,
        ..task(id, parent, Todo)
    }
}

fn goal(id: i64, parent: (&str, i64), status: &str) -> Goal {
    Goal {
        id: id.into(),
        title: format!("goal {id}"),
        parent_type: parent.0.to_string(),
        parent_id: parent.1.into(),
        status: status.to_string(),
        time_scope: None,
        on_scope_exit: None,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        beads_id: None,
        origin: Origin::Manual,
    }
}

fn commitment(id: i64, parent: (&str, i64), verdict: Verdict) -> Commitment {
    Commitment {
        id: id.into(),
        title: format!("commitment {id}"),
        parent_type: parent.0.to_string(),
        parent_id: parent.1.into(),
        verdict,
        time_scope: None,
        verdict_window: None,
        tag_ids: Vec::new(),
        position: id,
        is_private: false,
        beads_id: None,
        origin: Origin::Manual,
    }
}

fn wait(id: i64, parent: (&str, i64), status: ExpectationStatus) -> Expectation {
    Expectation {
        id: id.into(),
        title: format!("wait {id}"),
        parent_type: parent.0.to_string(),
        parent_id: parent.1.into(),
        status,
        archival: ExpectationArchival::Live,
        time_scope: None,
        tag_ids: Vec::new(),
        check_every: None,
        check_starting: None,
        last_check_at: None,
        position: id,
        is_private: false,
        agentic: false,
        agentic_note: None,
        question: false,
        answer: None,
        origin: Origin::Manual,
    }
}

fn archived(node_type: &str, id: i64) -> ItemLifecycle {
    ItemLifecycle {
        node_type: node_type.to_string(),
        node_id: id.into(),
        timing: Timing::Lapsed,
        resolution: None,
        overdue: false,
        verdict: None,
        archival: Archival::Archived,
        archival_conflict: false,
        plan_timing: None,
    }
}

/// A board of rows, derived with no governance, and each compound Task's status read back.
#[derive(Default)]
struct Board {
    tasks: Vec<Task>,
    checks: Vec<Task>,
    goals: Vec<Goal>,
    commitments: Vec<Commitment>,
    expectations: Vec<Expectation>,
    waits: Vec<Expectation>,
    lifecycles: Vec<ItemLifecycle>,
}

impl Board {
    fn derive_with(&self, governance: &HashMap<NodeId, Governance>) -> Vec<Outcome> {
        derive(
            &Rows {
                tasks: &self.tasks,
                checks: &self.checks,
                goals: &self.goals,
                commitments: &self.commitments,
                expectations: &self.expectations,
                waits: &self.waits,
                lifecycles: &self.lifecycles,
                wait_lifecycles: &[],
            },
            governance,
            at(12),
        )
    }

    fn status_of(&self, id: i64) -> TaskStatus {
        self.derive_with(&HashMap::new())
            .into_iter()
            .find(|outcome| outcome.id == NodeId::Stored(id))
            .map(|outcome| outcome.status)
            .unwrap()
    }
}

#[test]
fn the_progress_rule_reads_each_mix_as_specified() {
    assert_eq!(progress([]), Todo);
    assert_eq!(progress([Done, Done]), Done);
    assert_eq!(progress([Done, InProgress, Started]), InProgress);
    assert_eq!(progress([Done, Todo]), Started);
    assert_eq!(progress([Started, Todo]), Started);
    assert_eq!(progress([Todo, Todo]), Todo);
}

#[test]
fn each_kind_reads_as_the_rule_counts_it() {
    assert_eq!(goal_reading("achieved"), Done);
    assert_eq!(goal_reading("active"), Todo);
    assert_eq!(goal_reading("frozen"), Todo);
    assert_eq!(expectation_reading(ExpectationStatus::Pending), Started);
    assert_eq!(expectation_reading(ExpectationStatus::Released), Done);
    assert_eq!(commitment_reading(Verdict::Unresolved), Started);
    assert_eq!(commitment_reading(Verdict::Kept), Done);
    assert_eq!(commitment_reading(Verdict::Broken), Done);
    assert_eq!(task_reading("in_progress"), InProgress);
    assert_eq!(task_reading("nonsense"), Todo);
}

#[test]
fn a_compound_task_with_nothing_beneath_it_is_to_do() {
    let board = Board {
        tasks: vec![compound(1, ("project", 100))],
        ..Board::default()
    };
    assert_eq!(board.status_of(1), Todo);
}

#[test]
fn the_whole_subtree_counts_not_only_the_children() {
    let board = Board {
        tasks: vec![
            compound(1, ("project", 100)),
            task(2, ("task", 1), Done),
            task(3, ("task", 2), InProgress),
        ],
        ..Board::default()
    };
    assert_eq!(board.status_of(1), InProgress);
}

#[test]
fn every_kind_beneath_it_counts() {
    let mut board = Board {
        tasks: vec![compound(1, ("project", 100)), task(2, ("task", 1), Done)],
        goals: vec![goal(3, ("task", 1), "achieved")],
        commitments: vec![commitment(4, ("task", 1), Verdict::Kept)],
        expectations: vec![wait(5, ("task", 1), ExpectationStatus::Released)],
        ..Board::default()
    };
    assert_eq!(board.status_of(1), Done);

    // A pending wait beneath is something under way somewhere else: Started.
    board.expectations[0].status = ExpectationStatus::Pending;
    assert_eq!(board.status_of(1), Started);

    // So is an unresolved commitment.
    board.expectations[0].status = ExpectationStatus::Released;
    board.commitments[0].verdict = Verdict::Unresolved;
    assert_eq!(board.status_of(1), Started);
}

#[test]
fn a_goal_not_yet_achieved_counts_as_to_do() {
    let board = Board {
        tasks: vec![compound(1, ("project", 100)), task(2, ("task", 1), Done)],
        goals: vec![goal(3, ("task", 1), "active")],
        ..Board::default()
    };
    assert_eq!(board.status_of(1), Started);
}

#[test]
fn an_effectively_archived_item_is_left_out_with_everything_beneath_it() {
    let board = Board {
        tasks: vec![
            compound(1, ("project", 100)),
            task(2, ("task", 1), Done),
            task(3, ("task", 1), Todo),
            task(4, ("task", 3), InProgress),
        ],
        lifecycles: vec![archived("task", 3)],
        ..Board::default()
    };
    assert_eq!(board.status_of(1), Done);
}

#[test]
fn an_archived_wait_is_left_out() {
    let board = Board {
        tasks: vec![compound(1, ("project", 100)), task(2, ("task", 1), Done)],
        expectations: vec![Expectation {
            archival: ExpectationArchival::Archived,
            ..wait(5, ("task", 1), ExpectationStatus::Pending)
        }],
        ..Board::default()
    };
    assert_eq!(board.status_of(1), Done);
}

#[test]
fn backlogged_and_delegated_items_still_count() {
    let board = Board {
        tasks: vec![
            compound(1, ("project", 100)),
            Task {
                archival: TaskArchival::Backlog,
                ..task(2, ("task", 1), Todo)
            },
            Task {
                delegate_to: Some(Delegate::Agent),
                ..task(3, ("task", 1), Done)
            },
        ],
        ..Board::default()
    };
    assert_eq!(board.status_of(1), Started);
}

#[test]
fn a_check_task_beneath_a_wait_counts_as_a_task() {
    let board = Board {
        tasks: vec![compound(1, ("project", 100))],
        expectations: vec![wait(5, ("task", 1), ExpectationStatus::Released)],
        checks: vec![task(6, ("expectation", 5), InProgress)],
        ..Board::default()
    };
    assert_eq!(board.status_of(1), InProgress);
}

#[test]
fn a_compound_task_inside_is_counted_by_its_derived_status() {
    // The inner one's own stored status is To Do; what it reads as is Done, from its child.
    let board = Board {
        tasks: vec![
            compound(1, ("project", 100)),
            compound(2, ("task", 1)),
            task(3, ("task", 2), Done),
        ],
        ..Board::default()
    };
    assert_eq!(board.status_of(2), Done);
    assert_eq!(board.status_of(1), Done);
}

#[test]
fn a_compound_task_does_not_count_the_wait_its_own_delegation_draws() {
    let delegated = Task {
        delegate_to: Some(Delegate::Agent),
        ..compound(1, ("project", 100))
    };
    let own_wait = Expectation {
        origin: Origin::DelegationWait(WaitOrigin {
            task_id: NodeId::Stored(1),
        }),
        ..wait(9, ("task", 1), ExpectationStatus::Pending)
    };
    let board = Board {
        tasks: vec![delegated, task(2, ("task", 1), Done)],
        waits: vec![own_wait],
        ..Board::default()
    };
    assert_eq!(board.status_of(1), Done);
}

#[test]
fn an_ancestor_does_count_the_wait_a_compound_task_inside_draws() {
    let inner = Task {
        delegate_to: Some(Delegate::Agent),
        ..compound(2, ("task", 1))
    };
    let inner_wait = Expectation {
        origin: Origin::DelegationWait(WaitOrigin {
            task_id: NodeId::Stored(2),
        }),
        ..wait(9, ("task", 2), ExpectationStatus::Pending)
    };
    let board = Board {
        tasks: vec![
            compound(1, ("project", 100)),
            inner,
            task(3, ("task", 2), Todo),
        ],
        waits: vec![inner_wait],
        ..Board::default()
    };
    assert_eq!(board.status_of(2), Todo);
    assert_eq!(board.status_of(1), Started);
}

#[test]
fn a_done_compound_task_whose_window_passed_is_archived_and_still_counts_as_done() {
    let window = (at(0), at(6));
    let governance = HashMap::from([(
        NodeId::Stored(2),
        Governance {
            window: Some(window),
            on_exit: Some(OnScopeExit::Keep),
            due: Some(window),
            stored: Archival::Live,
        },
    )]);
    let board = Board {
        tasks: vec![
            compound(1, ("project", 100)),
            compound(2, ("task", 1)),
            task(3, ("task", 2), Done),
            task(4, ("task", 1), Done),
        ],
        // Its step finished inside the window, and was archived by finishing when it closed.
        lifecycles: vec![archived("task", 3)],
        ..Board::default()
    };
    let outcomes = board.derive_with(&governance);
    let inner = outcomes
        .iter()
        .find(|outcome| outcome.id == NodeId::Stored(2))
        .unwrap();
    assert_eq!(inner.status, Done);
    assert_eq!(
        inner.state.map(|state| state.archival),
        Some(Archival::Archived)
    );
    // Archived by finishing is still finished: the outer one counts it Done.
    let outer = outcomes
        .iter()
        .find(|outcome| outcome.id == NodeId::Stored(1))
        .unwrap();
    assert_eq!(outer.status, Done);
}

#[test]
fn apply_writes_the_status_and_the_lifecycle_onto_the_board() {
    let mut tasks = vec![compound(1, ("project", 100)), task(2, ("task", 1), Done)];
    let mut lifecycles = vec![ItemLifecycle {
        archival: Archival::Live,
        ..archived("task", 1)
    }];
    let state = derive_item_state(
        Some((at(0), at(6))),
        Some(OnScopeExit::Keep),
        Some((at(0), at(6))),
        true,
        Some(Archival::Live),
        at(12),
    );
    apply(
        &[Outcome {
            id: NodeId::Stored(1),
            status: Done,
            state: Some(state),
        }],
        &mut tasks,
        &mut lifecycles,
    );
    assert_eq!(tasks[0].status, "done");
    assert_eq!(tasks[1].status, "done");
    assert_eq!(lifecycles[0].archival, Archival::Archived);
}

#[test]
fn a_parent_loop_is_caught_rather_than_followed() {
    // Corrupt data: two compound tasks each under the other.
    let board = Board {
        tasks: vec![compound(1, ("task", 2)), compound(2, ("task", 1))],
        ..Board::default()
    };
    let outcomes = board.derive_with(&HashMap::new());
    assert_eq!(outcomes.len(), 2);
}
