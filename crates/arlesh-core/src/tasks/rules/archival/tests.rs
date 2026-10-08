use super::*;

fn id(n: i64) -> NodeId {
    NodeId::Stored(n)
}

fn entry(node_type: &str, n: i64) -> ItemLifecycle {
    ItemLifecycle {
        node_type: node_type.to_string(),
        node_id: id(n),
        timing: Timing::Lapsed,
        resolution: None,
        overdue: true,
        verdict: None,
        archival: Archival::Live,
        archival_conflict: false,
        plan_timing: None,
    }
}

fn archival_of<'a>(
    lifecycles: &'a [ItemLifecycle],
    node_type: &str,
    n: i64,
) -> Option<&'a ItemLifecycle> {
    lifecycles
        .iter()
        .find(|entry| entry.node_type == node_type && entry.node_id == id(n))
}

#[test]
fn every_descendant_of_a_task_archived_by_hand_reads_archived_and_is_never_overdue() {
    let (one, two, three, four, domain) = (id(1), id(2), id(3), id(4), id(9));
    let nodes = [
        TreeNode {
            node_type: "task",
            id: &one,
            parent_type: "domain",
            parent_id: &domain,
            archived_by_hand: true,
        },
        TreeNode {
            node_type: "task",
            id: &two,
            parent_type: "task",
            parent_id: &one,
            archived_by_hand: false,
        },
        TreeNode {
            node_type: "expectation",
            id: &three,
            parent_type: "task",
            parent_id: &two,
            archived_by_hand: false,
        },
        TreeNode {
            node_type: "task",
            id: &four,
            parent_type: "domain",
            parent_id: &domain,
            archived_by_hand: false,
        },
    ];
    let mut lifecycles = vec![entry("task", 2), entry("expectation", 3), entry("task", 4)];
    inherit(&nodes, &mut lifecycles);
    for (node_type, n) in [("task", 2), ("expectation", 3)] {
        let found = archival_of(&lifecycles, node_type, n).expect("an entry");
        assert_eq!(found.archival, Archival::Archived, "{node_type} {n}");
        assert!(!found.overdue, "{node_type} {n}");
    }
    let sibling = archival_of(&lifecycles, "task", 4).expect("an entry");
    assert_eq!(sibling.archival, Archival::Live);
    assert!(sibling.overdue);
}

#[test]
fn a_descendant_with_no_entry_gains_an_archived_one() {
    let (one, two, domain) = (id(1), id(2), id(9));
    let nodes = [
        TreeNode {
            node_type: "commitment",
            id: &one,
            parent_type: "domain",
            parent_id: &domain,
            archived_by_hand: true,
        },
        TreeNode {
            node_type: "expectation",
            id: &two,
            parent_type: "commitment",
            parent_id: &one,
            archived_by_hand: false,
        },
    ];
    let mut lifecycles = Vec::new();
    inherit(&nodes, &mut lifecycles);
    let gained = archival_of(&lifecycles, "expectation", 2).expect("an entry");
    assert_eq!(gained.archival, Archival::Archived);
    assert_eq!(gained.timing, Timing::Active);
}

#[test]
fn with_nothing_archived_by_hand_nothing_changes() {
    let (one, two) = (id(1), id(2));
    let nodes = [TreeNode {
        node_type: "task",
        id: &two,
        parent_type: "task",
        parent_id: &one,
        archived_by_hand: false,
    }];
    let mut lifecycles = vec![entry("task", 2)];
    inherit(&nodes, &mut lifecycles);
    assert_eq!(lifecycles[0].archival, Archival::Live);
    assert!(lifecycles[0].overdue);
}

#[test]
fn a_parent_loop_ends() {
    let (one, two) = (id(1), id(2));
    let nodes = [
        TreeNode {
            node_type: "task",
            id: &one,
            parent_type: "task",
            parent_id: &two,
            archived_by_hand: true,
        },
        TreeNode {
            node_type: "task",
            id: &two,
            parent_type: "task",
            parent_id: &one,
            archived_by_hand: false,
        },
    ];
    let mut lifecycles = vec![entry("task", 1), entry("task", 2)];
    inherit(&nodes, &mut lifecycles);
    assert!(lifecycles
        .iter()
        .all(|entry| entry.archival == Archival::Archived));
}
