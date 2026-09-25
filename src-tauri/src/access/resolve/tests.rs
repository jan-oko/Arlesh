use super::*;
use crate::access::model::{NodeKey, NodeTable};

// A small board:
//
//   Growth (aspect 1)
//   └── Arlesh (project 2)
//       ├── Ship v1 (goal 10)
//       │   ├── Write docs (task 100, agentic)
//       │   │   ├── Proofread (task 101, inherits agentic)
//       │   │   │   └── Notes (info 201)
//       │   │   └── Sign off (task 103, explicitly not agentic)
//       │   └── Diary (task 102, private)
//       │       └── Entry (info 200)
//       └── Launch (flow 20)
//           └── Announce (flow_task 30)
//   Body (aspect 3)
//   └── Run (task 110)

fn domain(id: i64) -> NodeKey {
    NodeKey::new(NodeTable::Domain, id)
}
fn goal(id: i64) -> NodeKey {
    NodeKey::new(NodeTable::Goal, id)
}
fn task(id: i64) -> NodeKey {
    NodeKey::new(NodeTable::Task, id)
}
fn info(id: i64) -> NodeKey {
    NodeKey::new(NodeTable::Info, id)
}
fn flow(id: i64) -> NodeKey {
    NodeKey::new(NodeTable::Flow, id)
}
fn flow_task(id: i64) -> NodeKey {
    NodeKey::new(NodeTable::FlowTask, id)
}

fn node(key: NodeKey, parent: Option<NodeKey>) -> StoredNode {
    StoredNode {
        key,
        parent,
        is_private: false,
        agentic: None,
        occurrence_agentic: None,
    }
}

fn private(key: NodeKey, parent: Option<NodeKey>) -> StoredNode {
    StoredNode {
        is_private: true,
        ..node(key, parent)
    }
}

fn agentic(key: NodeKey, parent: Option<NodeKey>, flag: bool) -> StoredNode {
    StoredNode {
        agentic: Some(flag),
        ..node(key, parent)
    }
}

fn board() -> Vec<StoredNode> {
    vec![
        node(domain(1), None),
        node(domain(2), Some(domain(1))),
        node(goal(10), Some(domain(2))),
        agentic(task(100), Some(goal(10)), true),
        node(task(101), Some(task(100))),
        node(info(201), Some(task(101))),
        agentic(task(103), Some(task(100)), false),
        private(task(102), Some(goal(10))),
        node(info(200), Some(task(102))),
        node(flow(20), Some(domain(2))),
        node(flow_task(30), Some(flow(20))),
        node(domain(3), None),
        node(task(110), Some(domain(3))),
    ]
}

#[test]
fn with_no_roots_nothing_is_visible() {
    let map = AccessMap::resolve(&board(), &[]);

    for stored in board() {
        assert_eq!(map.level(stored.key), AccessLevel::None, "{}", stored.key);
    }
    assert!(map.effective().is_empty());
}

#[test]
fn a_root_opens_its_whole_subtree_and_nothing_beside_or_above_it() {
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    for inside in [
        domain(2),
        goal(10),
        task(100),
        task(101),
        info(201),
        task(103),
        flow(20),
        flow_task(30),
    ] {
        assert!(map.can_read(inside), "{inside}");
    }
    assert_eq!(map.level(domain(1)), AccessLevel::None);
    assert_eq!(map.level(domain(3)), AccessLevel::None);
    assert_eq!(map.level(task(110)), AccessLevel::None);
}

#[test]
fn several_roots_each_open_their_own_subtree() {
    let map = AccessMap::resolve(&board(), &[goal(10), domain(3)]);

    assert!(map.can_read(task(101)));
    assert!(map.can_read(task(110)));
    assert!(!map.can_read(flow(20)));
    assert!(!map.can_read(domain(2)));
}

#[test]
fn an_agentic_task_inside_a_root_is_writable() {
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    assert_eq!(map.level(task(100)), AccessLevel::Write);
    assert!(map.can_read(task(100)), "write implies read");
}

#[test]
fn a_task_that_inherits_agentic_is_writable_too() {
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    assert_eq!(map.level(task(101)), AccessLevel::Write);
}

#[test]
fn an_explicit_not_agentic_overrides_an_agentic_ancestor() {
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    assert_eq!(map.level(task(103)), AccessLevel::Read);
}

#[test]
fn only_a_task_is_ever_writable_even_under_an_agentic_one() {
    // The note under the agentic task inherits the flag but is not a Task, and an agent performs
    // actions: it reads.
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    assert_eq!(map.level(info(201)), AccessLevel::Read);
    assert_eq!(map.level(goal(10)), AccessLevel::Read);
}

#[test]
fn a_non_agentic_task_is_read_only() {
    let map = AccessMap::resolve(&board(), &[domain(3)]);

    assert_eq!(map.level(task(110)), AccessLevel::Read);
    assert!(!map.can_write(task(110)));
}

#[test]
fn agentic_outside_every_root_opens_nothing() {
    let map = AccessMap::resolve(&board(), &[domain(3)]);

    assert_eq!(map.level(task(100)), AccessLevel::None);
}

#[test]
fn agentic_set_above_a_root_still_reaches_the_tasks_inside_it() {
    // The flag is read off the whole board, not only the part inside the root.
    let map = AccessMap::resolve(&board(), &[task(101)]);

    assert_eq!(map.level(task(101)), AccessLevel::Write);
}

#[test]
fn a_private_node_and_its_subtree_are_hidden_inside_a_root() {
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    assert_eq!(map.level(task(102)), AccessLevel::None);
    // Privacy covers the subtree: the note under the private task is not private itself, and is
    // still hidden.
    assert_eq!(map.level(info(200)), AccessLevel::None);
}

#[test]
fn a_root_inside_a_private_subtree_opens_nothing() {
    let nodes = vec![
        private(domain(1), None),
        node(goal(10), Some(domain(1))),
        node(task(100), Some(goal(10))),
    ];

    let map = AccessMap::resolve(&nodes, &[goal(10)]);

    assert_eq!(map.level(goal(10)), AccessLevel::None);
    assert_eq!(map.level(task(100)), AccessLevel::None);
}

#[test]
fn a_private_root_opens_nothing() {
    let map = AccessMap::resolve(&board(), &[task(102)]);

    assert!(map.effective().is_empty());
}

#[test]
fn a_node_that_is_not_stored_is_invisible() {
    let map = AccessMap::resolve(&board(), &[domain(1)]);

    assert_eq!(map.level(task(9_999)), AccessLevel::None);
}

#[test]
fn a_root_naming_a_node_that_is_not_stored_opens_nothing() {
    let map = AccessMap::resolve(&board(), &[task(9_999)]);

    assert!(map.effective().is_empty());
}

#[test]
fn a_dangling_parent_ends_the_climb_like_the_top_of_the_board() {
    let nodes = vec![node(task(1), Some(goal(404)))];

    let map = AccessMap::resolve(&nodes, &[task(1)]);

    assert_eq!(map.level(task(1)), AccessLevel::Read);
}

#[test]
fn a_parent_cycle_resolves_without_looping() {
    let nodes = vec![node(task(1), Some(task(2))), node(task(2), Some(task(1)))];

    let map = AccessMap::resolve(&nodes, &[task(2)]);

    assert_eq!(map.level(task(2)), AccessLevel::Read);
    assert_eq!(map.level(task(1)), AccessLevel::Read);
}

#[test]
fn a_deep_chain_does_not_overflow() {
    let depth = 50_000;
    let mut nodes = vec![node(task(0), None)];
    for id in 1..depth {
        nodes.push(node(task(id), Some(task(id - 1))));
    }

    let map = AccessMap::resolve(&nodes, &[task(0)]);

    assert_eq!(map.level(task(depth - 1)), AccessLevel::Read);
}

#[test]
fn effective_names_the_nearest_root_each_node_is_seen_through() {
    let map = AccessMap::resolve(&board(), &[domain(1), task(100)]);

    let entries = map.effective();
    let proofread = entries
        .iter()
        .find(|entry| entry.node_kind == NodeTable::Task && entry.node_id == 101)
        .expect("the proofread task is visible");
    assert_eq!(
        (proofread.root_kind, proofread.root_id),
        (NodeTable::Task, 100)
    );

    let launch = entries
        .iter()
        .find(|entry| entry.node_kind == NodeTable::Flow)
        .expect("the flow is visible");
    assert_eq!((launch.root_kind, launch.root_id), (NodeTable::Domain, 1));
    assert!(
        !entries
            .iter()
            .any(|entry| entry.node_kind == NodeTable::Task && entry.node_id == 102),
        "a private node is not listed"
    );
    assert_eq!(map.root_of(flow(20)), Some(domain(1)));
    assert_eq!(
        map.root_of(task(102)),
        None,
        "a private node is seen through nothing"
    );
}

#[test]
fn every_reference_spelling_of_a_domain_row_is_the_domain_table() {
    for spelling in ["aspect", "project", "domain", "tag"] {
        assert_eq!(
            NodeTable::from_reference(spelling),
            Some(NodeTable::Domain),
            "{spelling}"
        );
    }
    assert_eq!(NodeTable::from_reference("flow_root"), None);
    assert_eq!(NodeTable::from_reference("expectation_check"), None);
}

#[test]
fn levels_are_ordered_none_read_write() {
    assert!(AccessLevel::Write.permits(AccessLevel::Read));
    assert!(AccessLevel::Read.permits(AccessLevel::Read));
    assert!(!AccessLevel::Read.permits(AccessLevel::Write));
    assert!(!AccessLevel::None.permits(AccessLevel::Read));
}

#[test]
fn a_row_hung_on_an_agentic_occurrence_inherits_it_rather_than_its_hosts() {
    // The step's stored parent is the Habit's host, which is not Agentic; the occurrence it hangs
    // on is.
    let nodes = vec![
        node(domain(2), None),
        StoredNode {
            occurrence_agentic: Some(true),
            ..node(task(7), Some(domain(2)))
        },
        node(task(8), Some(task(7))),
    ];

    let map = AccessMap::resolve(&nodes, &[domain(2)]);

    assert_eq!(map.level(task(7)), AccessLevel::Write);
    assert_eq!(map.level(task(8)), AccessLevel::Write, "and hands it down");
}

#[test]
fn a_rows_own_flag_still_beats_its_occurrences() {
    let nodes = vec![
        node(domain(2), None),
        StoredNode {
            occurrence_agentic: Some(true),
            ..agentic(task(7), Some(domain(2)), false)
        },
    ];

    let map = AccessMap::resolve(&nodes, &[domain(2)]);

    assert_eq!(map.level(task(7)), AccessLevel::Read);
}

#[test]
fn an_agent_may_create_under_any_task_holder_inside_a_root() {
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    assert!(map.may_create_task_under(domain(2)), "a domain-table row");
    assert!(map.may_create_task_under(goal(10)), "a goal");
    assert!(map.may_create_task_under(task(100)), "an agentic task");
    assert!(
        map.may_create_task_under(task(101)),
        "a task that inherits agentic"
    );
}

#[test]
fn a_task_that_inherits_nothing_is_no_exception() {
    let map = AccessMap::resolve(&board(), &[domain(3)]);

    assert!(map.may_create_task_under(task(110)));
}

#[test]
fn nothing_is_created_under_a_task_explicitly_not_agentic() {
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    assert!(!map.may_create_task_under(task(103)));
}

#[test]
fn nothing_is_created_outside_the_roots_under_a_private_node_or_under_a_note() {
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    assert!(!map.may_create_task_under(domain(3)), "outside every root");
    assert!(!map.may_create_task_under(task(102)), "private");
    assert!(
        !map.may_create_task_under(info(201)),
        "a note holds no task"
    );
    assert!(!map.may_create_task_under(flow(20)), "nor does a flow");
}

#[test]
fn an_agent_may_create_under_a_visible_occurrence_unless_it_is_explicitly_not_agentic() {
    let map = AccessMap::resolve(&board(), &[domain(2)]);

    assert!(map.may_create_task_under_occurrence(domain(2), false, None));
    assert!(map.may_create_task_under_occurrence(domain(2), false, Some(true)));
    assert!(!map.may_create_task_under_occurrence(domain(2), false, Some(false)));
    assert!(
        !map.may_create_task_under_occurrence(domain(2), true, None),
        "private"
    );
    assert!(
        !map.may_create_task_under_occurrence(domain(3), false, None),
        "outside"
    );
}
