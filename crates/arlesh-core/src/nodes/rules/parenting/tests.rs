//! The parenting table, from the rules in `node-meta.ts`'s `isValidDropTarget`. The whole matrix
//! is pinned by `conformance/parenting.json`; these are the cases worth naming.

use super::*;

#[test]
fn an_aspect_never_moves_and_a_folded_run_neither_moves_nor_holds() {
    for parent in [NodeKind::Aspect, NodeKind::Project, NodeKind::Goal] {
        assert!(!may_parent(NodeKind::Aspect, parent));
        assert!(!may_parent(NodeKind::HabitGroup, parent));
    }
    for child in [NodeKind::Task, NodeKind::Info] {
        assert!(!may_parent(child, NodeKind::HabitGroup));
    }
}

#[test]
fn flows_and_real_nodes_never_mix() {
    assert!(may_parent(NodeKind::Flow, NodeKind::Goal));
    assert!(!may_parent(NodeKind::Flow, NodeKind::Task));
    assert!(!may_parent(NodeKind::Task, NodeKind::Flow));
    assert!(!may_parent(NodeKind::Info, NodeKind::FlowTask));
    assert!(may_parent(NodeKind::FlowTask, NodeKind::FlowTask));
    assert!(!may_parent(NodeKind::FlowGoal, NodeKind::FlowTask));
}

#[test]
fn a_tag_an_info_and_a_wait_hold_notes_and_nothing_else() {
    for parent in [NodeKind::Tag, NodeKind::Info, NodeKind::Expectation] {
        assert!(may_parent(NodeKind::Info, parent));
        assert!(!may_parent(NodeKind::Task, parent));
        assert!(!may_parent(NodeKind::Commitment, parent));
    }
}

#[test]
fn a_commitment_hangs_where_a_task_does_and_holds_tasks_commitments_and_waits() {
    for child in [NodeKind::Task, NodeKind::Commitment, NodeKind::Expectation] {
        assert!(may_parent(child, NodeKind::Commitment));
        assert!(may_parent(child, NodeKind::Task));
    }
    assert!(!may_parent(NodeKind::Goal, NodeKind::Commitment));
    assert!(!may_parent(NodeKind::Goal, NodeKind::Task));
}

#[test]
fn every_stored_parent_spelling_names_its_kind() {
    assert_eq!(kind_of("project"), Some(NodeKind::Project));
    assert_eq!(kind_of("flow_goal"), Some(NodeKind::FlowGoal));
    assert_eq!(
        kind_of("habit_group"),
        None,
        "a drawing is never a stored parent"
    );
    assert_eq!(kind_of("person"), None);
}

#[test]
fn template_items_follow_the_stored_table() {
    for child in [
        NodeKind::FlowTask,
        NodeKind::FlowCommitment,
        NodeKind::FlowExpectation,
    ] {
        for parent in [
            NodeKind::Flow,
            NodeKind::FlowGoal,
            NodeKind::FlowTask,
            NodeKind::FlowCommitment,
        ] {
            assert!(may_parent(child, parent), "{child:?} under {parent:?}");
        }
        assert!(!may_parent(child, NodeKind::FlowExpectation));
        assert!(!may_parent(child, NodeKind::Task));
    }
    assert!(!may_parent(NodeKind::FlowGoal, NodeKind::FlowCommitment));
    assert!(!may_parent(NodeKind::Info, NodeKind::FlowCommitment));
    assert_eq!(kind_of("flow_expectation"), Some(NodeKind::FlowExpectation));
}

#[test]
fn every_domains_table_subtype_is_stored_as_domain() {
    for spelling in ["aspect", "project", "domain", "tag"] {
        assert_eq!(stored_reference(spelling), "domain", "{spelling}");
    }
}

#[test]
fn every_other_reference_is_stored_as_given() {
    for spelling in [
        "goal",
        "task",
        "commitment",
        "expectation",
        "info",
        "flow",
        "flow_task",
    ] {
        assert_eq!(stored_reference(spelling), spelling);
    }
}

#[test]
fn a_domains_table_parent_is_the_kind_its_subtype_says() {
    assert_eq!(parent_kind("domain", Some("tag")), Some(NodeKind::Tag));
    assert_eq!(
        parent_kind("domain", Some("project")),
        Some(NodeKind::Project)
    );
    assert_eq!(
        parent_kind("project", Some("aspect")),
        Some(NodeKind::Aspect)
    );
}

#[test]
fn a_parent_with_no_subtype_is_the_kind_its_spelling_says() {
    assert_eq!(parent_kind("goal", None), Some(NodeKind::Goal));
    assert_eq!(parent_kind("domain", None), Some(NodeKind::Domain));
    assert_eq!(parent_kind("goal", Some("tag")), Some(NodeKind::Goal));
}
