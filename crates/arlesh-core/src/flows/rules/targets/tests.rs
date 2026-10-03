//! Which nodes a Flow may target.

use super::*;

#[test]
fn a_flow_targets_a_container_a_goal_or_a_task_and_nothing_else() {
    for node_type in ["aspect", "domain", "project", "goal", "task"] {
        assert!(holds_instances(node_type), "{node_type}");
    }
    for node_type in ["tag", "commitment", "expectation", "info", "flow"] {
        assert!(!holds_instances(node_type), "{node_type}");
    }
}
