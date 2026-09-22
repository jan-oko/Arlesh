//! Pruning: ancestor-keeping, subtree gating, and what an Info node can and cannot hold up.

use super::*;
use crate::filters::model::{BoardFilter, NodeFacts, NodeKind, OverrideMode, Preset};

fn node(id: &str, kind: NodeKind, children: Vec<FactNode>) -> FactNode {
    FactNode::with_children(NodeFacts::new(id, kind), children)
}

fn task(id: &str, status: &str) -> FactNode {
    let mut facts = NodeFacts::new(id, NodeKind::Task);
    facts.status = Some(status.to_string());
    FactNode::leaf(facts)
}

fn domain(id: &str, children: Vec<FactNode>) -> FactNode {
    node(id, NodeKind::Domain, children)
}

fn ids(tree: &FactNode) -> Vec<String> {
    kept_ids(tree).into_iter().collect()
}

#[test]
fn a_match_deep_in_a_branch_keeps_every_ancestor_that_reaches_it() {
    let root = domain(
        "domain-1",
        vec![domain("domain-2", vec![task("task-1", "in_progress")])],
    );
    let pruned = prune(&root, &BoardFilter::preset(Preset::Do)).expect("the branch survives");
    assert_eq!(ids(&pruned), ["domain-1", "domain-2", "task-1"]);
}

#[test]
fn a_branch_with_nothing_matching_in_it_drops_out_entirely() {
    let root = domain("domain-1", vec![domain("domain-2", vec![task("task-1", "todo")])]);
    assert!(prune(&root, &BoardFilter::preset(Preset::Do)).is_none());
}

#[test]
fn the_mindmap_root_is_returned_as_a_container_even_when_it_empties() {
    let root = domain("root", vec![task("task-1", "todo")]);
    let pruned = prune_tree(&root, &BoardFilter::preset(Preset::Do));
    assert_eq!(ids(&pruned), ["root"]);
    assert!(pruned.children.is_empty());
}

#[test]
fn an_info_note_rides_along_but_never_keeps_its_parent() {
    let mut achieved = NodeFacts::new("goal-1", NodeKind::Goal);
    achieved.status = Some("achieved".to_string());
    let root = domain(
        "root",
        vec![FactNode::with_children(
            achieved,
            vec![node("info-1", NodeKind::Info, vec![])],
        )],
    );
    assert_eq!(ids(&prune_tree(&root, &BoardFilter::preset(Preset::Plan))), ["root"]);
}

#[test]
fn a_hard_hidden_node_takes_its_whole_subtree_with_it() {
    let mut blocked = NodeFacts::new("task-1", NodeKind::Task);
    blocked.status = Some("todo".to_string());
    blocked.is_blocked = true;
    let root = domain(
        "root",
        vec![FactNode::with_children(blocked, vec![task("task-2", "todo")])],
    );
    assert_eq!(ids(&prune_tree(&root, &BoardFilter::preset(Preset::Start))), ["root"]);
    assert_eq!(
        ids(&prune_tree(&root, &BoardFilter::preset(Preset::Plan))),
        ["root", "task-1", "task-2"]
    );
}

#[test]
fn backlog_propagates_down_the_chain_but_a_container_status_does_not() {
    let mut set_aside = NodeFacts::new("task-1", NodeKind::Task);
    set_aside.status = Some("todo".to_string());
    set_aside.backlogged = true;
    let root = domain(
        "root",
        vec![FactNode::with_children(set_aside, vec![task("task-2", "todo")])],
    );
    assert_eq!(
        ids(&prune_tree(&root, &BoardFilter::preset(Preset::Backlog))),
        ["root", "task-1", "task-2"]
    );
}

#[test]
fn an_achieved_project_resolves_the_domains_inside_it() {
    let mut achieved = NodeFacts::new("domain-1", NodeKind::Project);
    achieved.status = Some("achieved".to_string());
    let forest = vec![FactNode::with_children(
        achieved,
        vec![domain("domain-2", vec![])],
    )];
    assert!(prune_forest(&forest, &BoardFilter::preset(Preset::Plan)).is_empty());

    let mut active = NodeFacts::new("domain-3", NodeKind::Project);
    active.status = Some("active".to_string());
    let forest = vec![FactNode::with_children(
        active,
        vec![domain("domain-4", vec![])],
    )];
    assert_eq!(
        kept_ids_in_forest(&prune_forest(&forest, &BoardFilter::preset(Preset::Plan)))
            .into_iter()
            .collect::<Vec<_>>(),
        ["domain-3", "domain-4"]
    );
}

#[test]
fn the_archived_pill_on_exclude_hides_a_subtree_that_all_would_otherwise_keep() {
    let mut archived = NodeFacts::new("goal-1", NodeKind::Goal);
    archived.status = Some("active".to_string());
    archived.archived = true;
    let root = domain(
        "root",
        vec![FactNode::with_children(archived, vec![task("task-1", "done")])],
    );
    let filter = BoardFilter {
        archived: OverrideMode::Exclude,
        ..BoardFilter::preset(Preset::All)
    };
    assert_eq!(ids(&prune_tree(&root, &filter)), ["root"]);
}
