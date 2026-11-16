//! Which nodes a Flow may target.

use super::*;
use crate::nodes::id::tid;

#[test]
fn a_flow_targets_a_container_a_goal_or_a_task_and_nothing_else() {
    for node_type in ["aspect", "domain", "project", "goal", "task"] {
        assert!(holds_instances(node_type), "{node_type}");
    }
    for node_type in ["tag", "commitment", "expectation", "info", "flow"] {
        assert!(!holds_instances(node_type), "{node_type}");
    }
}

fn copies() -> CopiedNodes {
    let mut copies = CopiedNodes::default();
    copies.record(NodeTable::Domain, tid(5), tid(50));
    copies.record(NodeTable::Goal, tid(6), tid(60));
    copies.record(NodeTable::Task, tid(7), tid(70));
    copies
}

#[test]
fn a_target_the_copy_carried_is_remapped_to_its_copy() {
    assert_eq!(
        copied_target_id(Some("goal"), Some(tid(6)), &copies()),
        Some(tid(60))
    );
    assert_eq!(
        copied_target_id(Some("task"), Some(tid(7)), &copies()),
        Some(tid(70))
    );
}

#[test]
fn a_domains_row_is_found_whichever_subtype_spelling_names_it() {
    for spelling in ["aspect", "project", "domain", "tag"] {
        assert_eq!(
            copied_target_id(Some(spelling), Some(tid(5)), &copies()),
            Some(tid(50)),
            "{spelling}"
        );
    }
}

#[test]
fn a_target_outside_the_copy_is_kept() {
    assert_eq!(
        copied_target_id(Some("goal"), Some(tid(99)), &copies()),
        None
    );
    // Same id, other table: goal 5 was not copied, only domain 5 was.
    assert_eq!(
        copied_target_id(Some("goal"), Some(tid(5)), &copies()),
        None
    );
}

#[test]
fn a_null_target_stays_null() {
    assert_eq!(copied_target_id(None, None, &copies()), None);
    assert_eq!(copied_target_id(Some("goal"), None, &copies()), None);
    assert_eq!(copied_target_id(None, Some(tid(6)), &copies()), None);
}

#[test]
fn an_unknown_spelling_is_never_remapped() {
    assert_eq!(
        copied_target_id(Some("flow_root"), Some(tid(6)), &copies()),
        None
    );
}
