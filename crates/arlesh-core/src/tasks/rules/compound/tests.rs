//! The progress rule, and deriving compound Tasks' statuses over a board.

use super::*;
use crate::{
    nodes::origin::WaitOrigin,
    tasks::{
        lifecycle::Timing,
        model::{AgenticStatus, Delegate, TaskArchival},
    },
};

use crate::tasks::model::TaskStatus::{Done, InProgress, Started, Todo};

pub(super) fn at(hour: u32) -> NaiveDateTime {
    chrono::NaiveDate::from_ymd_opt(2026, 9, 30)
        .and_then(|day| day.and_hms_opt(hour, 0, 0))
        .unwrap()
}

pub(super) fn task(id: i64, parent: (&str, i64), status: TaskStatus) -> Task {
    Task {
        id: id.into(),
        title: format!("task {id}"),
        parent_type: parent.0.to_string(),
        parent_id: parent.1.into(),
        status: Status::Ordinary(status),
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
        origin: Origin::Manual,
    }
}

pub(super) fn compound(id: i64, parent: (&str, i64)) -> Task {
    Task {
        compound: true,
        ..task(id, parent, Todo)
    }
}

pub(super) fn goal(id: i64, parent: (&str, i64), status: &str) -> Goal {
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
        origin: Origin::Manual,
    }
}

pub(super) fn commitment(id: i64, parent: (&str, i64), verdict: Verdict) -> Commitment {
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
        archival: Default::default(),
        origin: Origin::Manual,
    }
}

pub(super) fn wait(id: i64, parent: (&str, i64), status: ExpectationStatus) -> Expectation {
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

pub(super) fn archived(node_type: &str, id: i64) -> ItemLifecycle {
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
pub(super) struct Board {
    pub(super) tasks: Vec<Task>,
    pub(super) checks: Vec<Task>,
    pub(super) goals: Vec<Goal>,
    pub(super) commitments: Vec<Commitment>,
    pub(super) expectations: Vec<Expectation>,
    pub(super) waits: Vec<Expectation>,
    pub(super) lifecycles: Vec<ItemLifecycle>,
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
                settled: &std::collections::HashSet::new(),
                instants: &std::collections::HashMap::new(),
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

    /// The Task's derived status in the Agentic model, for a compound one.
    fn agentic_of(&self, id: i64) -> AgenticStatus {
        self.derive_with(&HashMap::new())
            .into_iter()
            .find(|outcome| outcome.id == NodeId::Stored(id))
            .and_then(|outcome| outcome.agentic)
            .unwrap()
    }

    /// The Task's outcome, or `None` when the rule leaves it as it is.
    fn outcome_of(&self, id: i64) -> Option<Outcome> {
        self.derive_with(&HashMap::new())
            .into_iter()
            .find(|outcome| outcome.id == NodeId::Stored(id))
    }

    fn subtree(&self, id: i64) -> SubItems {
        subtree_of(
            &Rows {
                tasks: &self.tasks,
                checks: &self.checks,
                goals: &self.goals,
                commitments: &self.commitments,
                expectations: &self.expectations,
                waits: &self.waits,
                lifecycles: &self.lifecycles,
                wait_lifecycles: &[],
                settled: &HashSet::new(),
                instants: &HashMap::new(),
            },
            &NodeId::Stored(id),
        )
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
    assert_eq!(task_reading(Status::Ordinary(InProgress)), InProgress);
    // The Agentic model counts in the ordinary one's terms: Doing is In Progress, On Agent and
    // Review are Started.
    assert_eq!(
        task_reading(Status::Agentic(AgenticStatus::Doing)),
        InProgress
    );
    assert_eq!(
        task_reading(Status::Agentic(AgenticStatus::OnAgent)),
        Started
    );
    assert_eq!(
        task_reading(Status::Agentic(AgenticStatus::Review)),
        Started
    );
    assert_eq!(task_reading(Status::Agentic(AgenticStatus::Done)), Done);
}

#[test]
fn an_agentic_compound_task_shows_its_tally_in_its_own_model() {
    let mut tasks = vec![Task {
        status: Status::Agentic(AgenticStatus::Todo),
        ..compound(1, ("project", 9))
    }];
    let outcome = Outcome {
        id: 1.into(),
        status: InProgress,
        agentic: Some(AgenticStatus::Doing),
        state: None,
        done_at: None,
    };
    apply(&[outcome], &mut tasks, &mut []);
    assert_eq!(tasks[0].status, Status::Agentic(AgenticStatus::Doing));
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
                delegate_to: Some(Delegate::Person { id: 2 }),
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
        delegate_to: Some(Delegate::Person { id: 2 }),
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
        delegate_to: Some(Delegate::Person { id: 2 }),
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
            agentic: Some(AgenticStatus::Done),
            state: Some(state),
            done_at: None,
        }],
        &mut tasks,
        &mut lifecycles,
    );
    assert_eq!(tasks[0].status.as_str(), "done");
    assert_eq!(tasks[1].status.as_str(), "done");
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

#[test]
fn a_compound_tasks_done_time_is_its_latest_finish_while_it_is_done() {
    let board = Board {
        tasks: vec![
            compound(1, ("project", 9)),
            task(2, ("task", 1), Done),
            task(3, ("task", 1), Done),
        ],
        ..Board::default()
    };
    let instants = HashMap::from([(NodeId::Stored(2), at(8)), (NodeId::Stored(3), at(10))]);
    let rows = |board: &Board, settled: &HashSet<NodeId>| {
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
                settled,
                instants: &instants,
            },
            &HashMap::new(),
            at(12),
        )
    };
    let outcomes = rows(&board, &HashSet::new());
    assert_eq!(outcomes[0].done_at, Some(at(10)));

    assert!(
        rows(&board, &HashSet::from([NodeId::Stored(1)])).is_empty(),
        "a compound already derived is not derived again"
    );
}

fn agentic_task(id: i64, parent: (&str, i64), status: AgenticStatus) -> Task {
    Task {
        status: Status::Agentic(status),
        ..task(id, parent, Todo)
    }
}

fn agentic_compound(id: i64, parent: (&str, i64)) -> Task {
    Task {
        compound: true,
        ..agentic_task(id, parent, AgenticStatus::Todo)
    }
}

mod parents {
    //! An ordinary Task with sub-items reads at least Started or In Progress from them.

    use super::*;

    fn parent_with(children: Vec<Task>) -> Board {
        let mut tasks = vec![task(1, ("project", 100), Todo)];
        tasks.extend(children);
        Board {
            tasks,
            ..Board::default()
        }
    }

    #[test]
    fn a_to_do_parent_reads_in_progress_when_a_child_is() {
        let board = parent_with(vec![task(2, ("task", 1), InProgress)]);
        assert_eq!(board.status_of(1), InProgress);
    }

    #[test]
    fn a_to_do_parent_reads_started_from_a_started_or_done_child() {
        assert_eq!(
            parent_with(vec![task(2, ("task", 1), Started)]).status_of(1),
            Started
        );
        assert_eq!(
            parent_with(vec![task(2, ("task", 1), Done), task(3, ("task", 1), Todo)]).status_of(1),
            Started
        );
    }

    #[test]
    fn a_parent_whose_children_are_all_done_reads_started_never_done() {
        let board = parent_with(vec![task(2, ("task", 1), Done)]);
        assert_eq!(board.status_of(1), Started);
    }

    #[test]
    fn a_parent_of_to_do_children_stays_to_do() {
        let board = parent_with(vec![task(2, ("task", 1), Todo)]);
        assert_eq!(board.status_of(1), Todo);
    }

    #[test]
    fn the_whole_subtree_counts() {
        let board = parent_with(vec![
            task(2, ("task", 1), Todo),
            task(3, ("task", 2), InProgress),
        ]);
        assert_eq!(board.status_of(1), InProgress);
        assert_eq!(board.status_of(2), InProgress);
    }

    #[test]
    fn a_pending_wait_or_an_unresolved_commitment_makes_it_started() {
        let mut board = parent_with(vec![]);
        board.expectations = vec![wait(5, ("task", 1), ExpectationStatus::Pending)];
        assert_eq!(board.status_of(1), Started);
        board.expectations.clear();
        board.commitments = vec![commitment(6, ("task", 1), Verdict::Unresolved)];
        assert_eq!(board.status_of(1), Started);
    }

    #[test]
    fn an_archived_child_is_left_out() {
        let mut board = parent_with(vec![task(2, ("task", 1), InProgress)]);
        board.lifecycles = vec![archived("task", 2)];
        assert!(board
            .outcome_of(1)
            .is_some_and(|outcome| outcome.status == Todo));
    }

    #[test]
    fn its_own_status_is_kept_when_it_is_further_along() {
        let mut board = parent_with(vec![task(2, ("task", 1), Started)]);
        board.tasks[0].status = Status::Ordinary(InProgress);
        assert_eq!(board.status_of(1), InProgress);
    }

    #[test]
    fn a_parent_already_done_stays_done_with_an_open_child() {
        let mut board = parent_with(vec![task(2, ("task", 1), Todo)]);
        board.tasks[0].status = Status::Ordinary(Done);
        assert!(board.outcome_of(1).is_none());
    }

    #[test]
    fn a_started_parent_rises_to_in_progress_with_a_child_that_is() {
        let mut board = parent_with(vec![task(2, ("task", 1), InProgress)]);
        board.tasks[0].status = Status::Ordinary(Started);
        assert_eq!(board.status_of(1), InProgress);
    }

    #[test]
    fn the_wait_its_own_delegation_draws_is_not_a_sub_item() {
        let mut board = parent_with(vec![task(2, ("task", 1), Todo)]);
        board.tasks[0].delegate_to = Some(Delegate::Person { id: 2 });
        board.waits = vec![Expectation {
            origin: Origin::DelegationWait(WaitOrigin {
                task_id: NodeId::Stored(1),
            }),
            ..wait(9, ("task", 1), ExpectationStatus::Pending)
        }];
        assert_eq!(board.status_of(1), Todo);
    }

    #[test]
    fn an_agentic_task_is_not_derived() {
        let board = Board {
            tasks: vec![
                agentic_task(1, ("project", 100), AgenticStatus::Todo),
                task(2, ("task", 1), InProgress),
            ],
            ..Board::default()
        };
        assert!(board.outcome_of(1).is_none());
    }

    #[test]
    fn an_agentic_child_counts_by_its_reading() {
        let board = Board {
            tasks: vec![
                task(1, ("project", 100), Todo),
                agentic_task(2, ("task", 1), AgenticStatus::Doing),
            ],
            ..Board::default()
        };
        assert_eq!(board.status_of(1), InProgress);
    }

    #[test]
    fn apply_writes_a_parents_status_and_leaves_its_lifecycle() {
        let mut board = parent_with(vec![task(2, ("task", 1), InProgress)]);
        let outcomes = board.derive_with(&HashMap::new());
        let mut lifecycles = Vec::new();
        apply(&outcomes, &mut board.tasks, &mut lifecycles);
        assert_eq!(board.tasks[0].status, Status::Ordinary(InProgress));
    }

    #[test]
    fn the_subtree_says_its_floor_and_what_is_open() {
        let mut board = parent_with(vec![
            task(2, ("task", 1), Done),
            Task {
                archival: TaskArchival::Backlog,
                ..task(3, ("task", 1), Todo)
            },
        ]);
        board.expectations = vec![wait(5, ("task", 1), ExpectationStatus::Pending)];
        let subtree = board.subtree(1);
        assert_eq!(subtree.floor, Started);
        assert_eq!(subtree.open, 2, "the Backlogged child and the pending wait");
    }

    #[test]
    fn an_archived_open_child_does_not_hold_the_parent_open() {
        let mut board = parent_with(vec![task(2, ("task", 1), Done), task(3, ("task", 1), Todo)]);
        board.lifecycles = vec![archived("task", 3)];
        assert_eq!(board.subtree(1).open, 0);
    }
}

mod agentic_compound {
    //! A Compound Task that reads as Agentic shows who holds its items.

    use super::*;
    use crate::tasks::model::AgenticStatus::{Doing, OnAgent, Review};

    fn compound_of(children: Vec<Task>) -> Board {
        let mut tasks = vec![agentic_compound(1, ("project", 100))];
        tasks.extend(children);
        Board {
            tasks,
            ..Board::default()
        }
    }

    fn child(id: i64, status: AgenticStatus) -> Task {
        agentic_task(id, ("task", 1), status)
    }

    #[test]
    fn to_do_and_on_agent_read_on_agent() {
        let board = compound_of(vec![child(2, AgenticStatus::Todo), child(3, OnAgent)]);
        assert_eq!(board.agentic_of(1), OnAgent);
    }

    #[test]
    fn to_do_and_review_read_review() {
        let board = compound_of(vec![child(2, AgenticStatus::Todo), child(3, Review)]);
        assert_eq!(board.agentic_of(1), Review);
    }

    #[test]
    fn on_agent_and_review_mixed_read_review() {
        let board = compound_of(vec![child(2, OnAgent), child(3, Review)]);
        assert_eq!(board.agentic_of(1), Review);
    }

    #[test]
    fn a_child_whose_question_is_open_reads_review_before_the_board_derives_it() {
        let mut board = compound_of(vec![child(2, OnAgent), child(3, OnAgent)]);
        board.expectations = vec![Expectation {
            agentic: true,
            question: true,
            ..wait(9, ("task", 3), ExpectationStatus::Pending)
        }];
        assert_eq!(board.agentic_of(1), Review);
    }

    #[test]
    fn all_to_do_stays_to_do() {
        let board = compound_of(vec![child(2, AgenticStatus::Todo)]);
        assert_eq!(board.agentic_of(1), AgenticStatus::Todo);
    }

    #[test]
    fn doing_beats_on_agent_and_review() {
        let board = compound_of(vec![child(2, Doing), child(3, Review), child(4, OnAgent)]);
        assert_eq!(board.agentic_of(1), Doing);
    }

    #[test]
    fn done_items_are_ignored() {
        let board = compound_of(vec![
            child(2, AgenticStatus::Done),
            child(3, AgenticStatus::Todo),
        ]);
        assert_eq!(board.agentic_of(1), AgenticStatus::Todo);
        let board = compound_of(vec![child(2, AgenticStatus::Done), child(3, OnAgent)]);
        assert_eq!(board.agentic_of(1), OnAgent);
    }

    #[test]
    fn all_done_reads_done() {
        let board = compound_of(vec![child(2, AgenticStatus::Done)]);
        assert_eq!(board.agentic_of(1), AgenticStatus::Done);
    }

    #[test]
    fn a_pending_wait_beneath_reads_on_agent() {
        let mut board = compound_of(vec![child(2, AgenticStatus::Todo)]);
        board.expectations = vec![wait(5, ("task", 2), ExpectationStatus::Pending)];
        assert_eq!(board.agentic_of(1), OnAgent);
    }

    #[test]
    fn an_ordinary_compound_task_keeps_its_ordinary_mapping() {
        let board = Board {
            tasks: vec![
                compound(1, ("project", 100)),
                agentic_task(2, ("task", 1), OnAgent),
                agentic_task(3, ("task", 1), AgenticStatus::Todo),
            ],
            ..Board::default()
        };
        assert_eq!(board.status_of(1), Started);
    }

    #[test]
    fn a_nested_agentic_compound_passes_its_review_up() {
        let board = Board {
            tasks: vec![
                agentic_compound(1, ("project", 100)),
                agentic_compound(2, ("task", 1)),
                agentic_task(3, ("task", 2), Review),
                agentic_task(4, ("task", 1), OnAgent),
            ],
            ..Board::default()
        };
        assert_eq!(board.agentic_of(2), Review);
        assert_eq!(board.agentic_of(1), Review);
    }

    #[test]
    fn apply_puts_the_agentic_reading_into_an_agentic_compound_task() {
        let mut board = compound_of(vec![child(2, OnAgent), child(3, Review)]);
        let outcomes = board.derive_with(&HashMap::new());
        apply(&outcomes, &mut board.tasks, &mut []);
        assert_eq!(board.tasks[0].status, Status::Agentic(Review));
    }
}
