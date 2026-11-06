use super::*;
use crate::access::model::NodeTable;

// Growth (domain 1)
// ├── Arlesh (domain 2)
// │   ├── Ship (goal 10)
// │   │   └── Docs (task 100)
// │   └── Launch (goal 11)
// └── Body (domain 3)

fn key(kind: NodeTable, id: i64) -> NodeKey {
    NodeKey::new(kind, id)
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

fn lineage() -> Lineage {
    let growth = key(NodeTable::Domain, 1);
    let arlesh = key(NodeTable::Domain, 2);
    let ship = key(NodeTable::Goal, 10);
    Lineage::of(&[
        node(growth, None),
        node(arlesh, Some(growth)),
        node(key(NodeTable::Domain, 3), Some(growth)),
        node(ship, Some(arlesh)),
        node(key(NodeTable::Goal, 11), Some(arlesh)),
        node(key(NodeTable::Task, 100), Some(ship)),
    ])
}

fn held(agent: i64, root: NodeKey, at: &str) -> Held {
    Held {
        agent: AgentId(agent),
        root,
        claimed_at: at.to_owned(),
    }
}

#[test]
fn a_subtree_overlaps_itself_its_ancestors_and_its_descendants() {
    let lineage = lineage();
    let ship = key(NodeTable::Goal, 10);

    assert!(lineage.overlaps(ship, ship));
    assert!(lineage.overlaps(ship, key(NodeTable::Domain, 2)));
    assert!(lineage.overlaps(key(NodeTable::Domain, 2), ship));
    assert!(lineage.overlaps(ship, key(NodeTable::Task, 100)));
}

#[test]
fn siblings_do_not_overlap() {
    let lineage = lineage();

    assert!(!lineage.overlaps(key(NodeTable::Goal, 10), key(NodeTable::Goal, 11)));
    assert!(!lineage.overlaps(key(NodeTable::Domain, 2), key(NodeTable::Domain, 3)));
}

#[test]
fn a_claim_outside_the_roots_is_refused_before_overlap_is_looked_at() {
    let result = check(&lineage(), key(NodeTable::Goal, 10), false, &[], AgentId(1));

    assert_eq!(result, Err(Refusal::OutsideRoots));
}

#[test]
fn a_claim_overlapping_another_agents_is_refused_naming_the_holder() {
    let others = [held(7, key(NodeTable::Domain, 2), "2026-11-07T09:00:00")];

    let result = check(&lineage(), key(NodeTable::Task, 100), true, &others, AgentId(1));

    assert_eq!(result, Err(Refusal::Overlaps { holder: AgentId(7) }));
}

#[test]
fn an_agent_may_claim_again_over_its_own_claim() {
    let own = [held(1, key(NodeTable::Goal, 10), "2026-11-07T09:00:00")];

    let result = check(&lineage(), key(NodeTable::Domain, 2), true, &own, AgentId(1));

    assert_eq!(result, Ok(()));
}

#[test]
fn a_sibling_subtree_is_free_to_claim() {
    let others = [held(7, key(NodeTable::Goal, 10), "2026-11-07T09:00:00")];

    let result = check(&lineage(), key(NodeTable::Goal, 11), true, &others, AgentId(1));

    assert_eq!(result, Ok(()));
}

#[test]
fn when_two_claims_come_to_overlap_the_younger_is_shadowed() {
    let claims = [
        held(1, key(NodeTable::Goal, 10), "2026-11-07T09:00:00"),
        held(2, key(NodeTable::Domain, 2), "2026-11-07T10:00:00"),
        held(3, key(NodeTable::Domain, 3), "2026-11-07T10:30:00"),
    ];

    assert_eq!(shadowed(&lineage(), &claims), HashSet::from([AgentId(2)]));
}

#[test]
fn claims_made_at_the_same_instant_are_told_apart_by_agent_id() {
    let claims = [
        held(5, key(NodeTable::Goal, 10), "2026-11-07T09:00:00"),
        held(4, key(NodeTable::Domain, 2), "2026-11-07T09:00:00"),
    ];

    assert_eq!(shadowed(&lineage(), &claims), HashSet::from([AgentId(5)]));
}

#[test]
fn a_claim_stands_as_unclaimed_unreachable_paused_shadowed_or_active() {
    let root = key(NodeTable::Goal, 10);
    let active = Some((ClaimStatus::Active, root));
    let paused = Some((ClaimStatus::Paused, root));

    assert_eq!(standing(None, true, false), AgentStanding::Unclaimed);
    assert_eq!(standing(active.clone(), false, false), AgentStanding::Unreachable);
    assert_eq!(standing(paused, true, true), AgentStanding::Paused);
    assert_eq!(standing(active.clone(), true, true), AgentStanding::Shadowed);
    assert_eq!(standing(active, true, false), AgentStanding::Active);
}
