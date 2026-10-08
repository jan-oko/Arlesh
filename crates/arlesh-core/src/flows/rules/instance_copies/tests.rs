//! Which started-instance links a subtree copy carries over.

use super::*;
use crate::access::model::NodeTable;

fn node(node_type: &str, node_id: i64) -> TargetRef {
    TargetRef {
        node_type: node_type.to_string(),
        node_id,
    }
}

/// Run 1 of flow 7, rooted at goal 10 under project 3, holding goal 10 and task 11.
fn run() -> Vec<InstanceNode> {
    let row = |materialised: TargetRef, source: TargetRef, parent: TargetRef| InstanceNode {
        instance_id: 1,
        flow_id: Some(7),
        root: node("goal", 10),
        started_at: 500,
        node: materialised,
        source,
        original_parent: parent,
    };
    vec![
        row(node("goal", 10), node("flow", 7), node("project", 3)),
        row(node("task", 11), node("flow_task", 4), node("goal", 10)),
    ]
}

#[test]
fn a_copied_run_keeps_the_original_flow_and_start_and_points_at_the_copies() {
    let mut copies = CopiedNodes::default();
    copies.record(NodeTable::Goal, 10, 20);
    copies.record(NodeTable::Task, 11, 21);
    assert_eq!(
        copied_instances(&run(), &copies),
        vec![InstanceCopy {
            flow_id: Some(7),
            root: node("goal", 20),
            started_at: 500,
            nodes: vec![
                InstanceNodeCopy {
                    node: node("goal", 20),
                    source: node("flow", 7),
                    // The run's target was outside the copy, so it stays the original.
                    original_parent: node("project", 3),
                },
                InstanceNodeCopy {
                    node: node("task", 21),
                    source: node("flow_task", 4),
                    // Its parent came along, so it reads as never moved.
                    original_parent: node("goal", 20),
                },
            ],
        }]
    );
}

#[test]
fn a_run_reached_below_its_root_is_rooted_at_its_first_copied_node() {
    let mut copies = CopiedNodes::default();
    copies.record(NodeTable::Task, 11, 21);
    let [copy] = copied_instances(&run(), &copies).try_into().unwrap();
    assert_eq!(copy.root, node("task", 21));
    assert_eq!(copy.nodes.len(), 1);
    assert_eq!(copy.nodes[0].original_parent, node("goal", 10));
}

#[test]
fn a_run_the_copy_did_not_reach_is_left_alone() {
    let mut copies = CopiedNodes::default();
    copies.record(NodeTable::Task, 99, 100);
    assert!(copied_instances(&run(), &copies).is_empty());
}
