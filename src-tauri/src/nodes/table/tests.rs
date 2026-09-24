use chrono::NaiveDate;

use super::*;
use crate::{
    nodes::{
        key::{TemplateItem, TemplateKind},
        origin::Origin,
    },
    tasks::model::{ExpectationArchival, ExpectationStatus, TaskArchival, Verdict},
};

fn occurrence(item_type: TemplateKind, item_id: i64) -> OccurrenceKey {
    OccurrenceKey {
        item: TemplateItem { item_type, item_id },
        iteration: crate::scopes::key::ScopeKey::day(NaiveDate::from_ymd_opt(2026, 9, 20).unwrap()),
        cycle: 0,
    }
}

fn task(id: NodeId, parent_type: &str, parent_id: NodeId) -> Task {
    Task {
        id,
        title: "t".into(),
        parent_type: parent_type.into(),
        parent_id,
        status: "todo".into(),
        delegate_to: None,
        agentic: None,
        asynchronous: false,
        async_template: None,
        agentic_brief: None,
        time_scope: None,
        on_scope_exit: None,
        plan: None,
        archival: TaskArchival::Live,
        tag_ids: vec![],
        position: 0,
        is_private: false,
        beads_id: None,
        origin: Origin::Manual,
    }
}

fn goal(id: i64) -> Goal {
    Goal {
        id: id.into(),
        title: "g".into(),
        parent_type: "project".into(),
        parent_id: 1.into(),
        status: "active".into(),
        time_scope: None,
        on_scope_exit: None,
        tag_ids: vec![],
        position: 0,
        is_private: false,
        beads_id: None,
        origin: Origin::Manual,
    }
}

fn commitment(id: i64) -> Commitment {
    Commitment {
        id: id.into(),
        title: "c".into(),
        parent_type: "project".into(),
        parent_id: 1.into(),
        verdict: Verdict::Unresolved,
        time_scope: None,
        verdict_window: None,
        tag_ids: vec![],
        position: 0,
        is_private: false,
        beads_id: None,
        origin: Origin::Manual,
    }
}

fn info(id: i64) -> Info {
    Info {
        id,
        body: "i".into(),
        details: None,
        parent_type: "project".into(),
        parent_id: 1.into(),
        position: 0,
        is_private: false,
    }
}

fn expectation(id: i64) -> Expectation {
    Expectation {
        id: id.into(),
        title: "e".into(),
        parent_type: "project".into(),
        parent_id: 1.into(),
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        position: 0,
        is_private: false,
        time_scope: None,
        tag_ids: vec![],
        check_every: None,
        check_starting: None,
        last_check_at: None,
        agentic: false,
        agentic_note: None,
        origin: Default::default(),
    }
}

fn child(parent: &OccurrenceKey, child_type: &str, child_id: i64) -> HabitInstanceChild {
    HabitInstanceChild {
        flow_id: 4,
        parent_kind: "task".into(),
        parent_key: parent.node_key(),
        child_type: child_type.into(),
        child_id,
    }
}

#[test]
fn a_stored_child_of_a_derived_occurrence_reads_the_occurrence_as_its_parent() {
    let root = occurrence(TemplateKind::FlowRoot, 4);
    let derived = DerivedRows {
        tasks: vec![task(NodeId::Derived(root.id()), "project", 1.into())],
        ..DerivedRows::default()
    };
    let mut tasks = vec![
        task(10.into(), "project", 1.into()),
        task(11.into(), "project", 1.into()),
    ];
    let mut goals = vec![goal(20)];
    let mut commitments = vec![commitment(30)];
    let mut expectations = vec![expectation(40)];
    let mut infos = vec![info(50)];
    let children = vec![
        child(&root, "task", 10),
        child(&root, "goal", 20),
        child(&root, "commitment", 30),
        child(&root, "expectation", 40),
        child(&root, "info", 50),
    ];
    attach_children(
        &children,
        &derived,
        StoredRows {
            tasks: &mut tasks,
            goals: &mut goals,
            commitments: &mut commitments,
            expectations: &mut expectations,
            infos: &mut infos,
        },
    );
    let parent = NodeId::Derived(root.id());
    assert_eq!(
        (tasks[0].parent_type.as_str(), &tasks[0].parent_id),
        ("task", &parent)
    );
    assert_eq!(
        tasks[1].parent_id,
        NodeId::Stored(1),
        "an unattached row keeps its parent"
    );
    assert_eq!(goals[0].parent_id, parent);
    assert_eq!(commitments[0].parent_id, parent);
    assert_eq!(expectations[0].parent_id, parent);
    assert_eq!(infos[0].parent_id, parent);
}

#[test]
fn a_child_of_an_occurrence_not_derived_keeps_its_stored_parent() {
    let gone = occurrence(TemplateKind::FlowTask, 9);
    let mut tasks = vec![task(10.into(), "project", 1.into())];
    attach_children(
        &[child(&gone, "task", 10)],
        &DerivedRows::default(),
        StoredRows {
            tasks: &mut tasks,
            goals: &mut [],
            commitments: &mut [],
            expectations: &mut [],
            infos: &mut [],
        },
    );
    assert_eq!(tasks[0].parent_type, "project");
    assert_eq!(tasks[0].parent_id, NodeId::Stored(1));
}

#[test]
fn a_goal_or_commitment_occurrence_parents_as_its_kind() {
    let goal_root = occurrence(TemplateKind::FlowRoot, 5);
    let commitment_root = occurrence(TemplateKind::FlowRoot, 6);
    let mut derived_goal = goal(0);
    derived_goal.id = NodeId::Derived(goal_root.id());
    let mut derived_commitment = commitment(0);
    derived_commitment.id = NodeId::Derived(commitment_root.id());
    let derived = DerivedRows {
        goals: vec![derived_goal],
        commitments: vec![derived_commitment],
        ..DerivedRows::default()
    };
    let mut infos = vec![info(1), info(2)];
    attach_children(
        &[
            child(&goal_root, "info", 1),
            child(&commitment_root, "info", 2),
        ],
        &derived,
        StoredRows {
            tasks: &mut [],
            goals: &mut [],
            commitments: &mut [],
            expectations: &mut [],
            infos: &mut infos,
        },
    );
    assert_eq!(infos[0].parent_type, "goal");
    assert_eq!(infos[1].parent_type, "commitment");
}
