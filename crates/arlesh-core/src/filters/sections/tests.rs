//! The List View's lifted sections, ported from `src/utils/list-sections.test.ts` as their
//! specification. Drawing — headers and markers — stays with the frontend; this is the partition.

use super::*;
use crate::filters::{list, model::NodeFacts, tree::FactNode};

fn task(id: &str) -> NodeFacts {
    let mut facts = NodeFacts::new(id, NodeKind::Task);
    facts.status = Some("todo".to_string());
    facts
}

fn asynchronous(id: &str) -> NodeFacts {
    let mut facts = task(id);
    facts.asynchronous = true;
    facts
}

fn overdue(id: &str) -> NodeFacts {
    let mut facts = task(id);
    facts.overdue = true;
    facts
}

fn review(id: &str) -> NodeFacts {
    let mut facts = task(id);
    facts.agentic = true;
    facts.status = Some("review".to_string());
    facts
}

fn tree(node: NodeFacts, children: Vec<FactNode>) -> FactNode {
    FactNode::with_children(node, children)
}

fn leaf(node: NodeFacts) -> FactNode {
    FactNode::leaf(node)
}

/// A framed board: the root is neither a row nor an ancestor.
fn board(children: Vec<FactNode>) -> Vec<OwnedRow> {
    let root = tree(NodeFacts::new("root", NodeKind::Aspect), children);
    list::flatten_kinds(
        &root,
        &[NodeKind::Task, NodeKind::Commitment, NodeKind::Expectation],
    )
}

fn ids(rows: &[&OwnedRow]) -> Vec<String> {
    rows.iter().map(|row| row.node.id.clone()).collect()
}

/// Each drawn section's row ids, and the rest's.
fn parts(rows: &[OwnedRow], sections: Sections) -> (Vec<(Section, Vec<String>)>, Vec<String>) {
    let partition = partition(rows, sections);
    (
        partition
            .sections
            .iter()
            .map(|(section, rows)| (*section, ids(rows)))
            .collect(),
        ids(&partition.rest),
    )
}

const ASYNC_ONLY: Sections = Sections {
    review: false,
    overdue: false,
    asynchronous: true,
};

const EVERY: Sections = Sections {
    review: true,
    overdue: true,
    asynchronous: true,
};

#[test]
fn an_asynchronous_row_moves_to_the_top_and_out_of_its_run() {
    let rows = board(vec![
        leaf(task("task-1")),
        leaf(asynchronous("task-2")),
        leaf(task("task-3")),
    ]);
    let (sections, rest) = parts(&rows, ASYNC_ONLY);
    assert_eq!(
        sections,
        [(Section::Asynchronous, vec!["task-2".to_string()])]
    );
    assert_eq!(rest, ["task-1", "task-3"], "moved, not duplicated");
}

#[test]
fn a_lifted_row_brings_its_whole_subtree_and_nothing_lifts_twice() {
    let rows = board(vec![tree(
        asynchronous("task-1"),
        vec![tree(asynchronous("task-2"), vec![leaf(task("task-3"))])],
    )]);
    let (sections, rest) = parts(&rows, ASYNC_ONLY);
    assert_eq!(
        sections,
        [(
            Section::Asynchronous,
            vec![
                "task-1".to_string(),
                "task-2".to_string(),
                "task-3".to_string()
            ]
        )]
    );
    assert!(rest.is_empty());
}

#[test]
fn a_descendant_follows_its_lifted_ancestor_across_a_filtered_out_row() {
    let mut rows = board(vec![tree(
        asynchronous("task-1"),
        vec![tree(task("task-2"), vec![leaf(task("task-3"))])],
    )]);
    rows.retain(|row| row.node.id != "task-2");
    let (sections, _) = parts(&rows, ASYNC_ONLY);
    assert_eq!(
        sections,
        [(
            Section::Asynchronous,
            vec!["task-1".to_string(), "task-3".to_string()]
        )]
    );
}

#[test]
fn a_section_with_nothing_in_it_is_not_drawn() {
    let rows = board(vec![leaf(task("task-1"))]);
    let (sections, rest) = parts(&rows, EVERY);
    assert!(sections.is_empty());
    assert_eq!(rest, ["task-1"]);
}

#[test]
fn review_leads_then_overdue_then_asynchronous_and_a_row_goes_to_the_first_that_claims_it() {
    let rows = board(vec![
        leaf(asynchronous("task-async")),
        leaf({
            let mut both = overdue("task-both");
            both.asynchronous = true;
            both
        }),
        leaf(review("task-review")),
        leaf(task("task-plain")),
    ]);
    let (sections, rest) = parts(&rows, EVERY);
    assert_eq!(
        sections,
        [
            (Section::Review, vec!["task-review".to_string()]),
            (Section::Overdue, vec!["task-both".to_string()]),
            (Section::Asynchronous, vec!["task-async".to_string()]),
        ]
    );
    assert_eq!(rest, ["task-plain"]);
}

#[test]
fn a_commitment_is_never_claimed_but_rides_up_under_a_lifted_row() {
    let mut commitment = NodeFacts::new("commitment-1", NodeKind::Commitment);
    commitment.overdue = false;
    let mut wait = NodeFacts::new("expectation-1", NodeKind::Expectation);
    wait.overdue = true;
    let rows = board(vec![
        leaf(commitment.clone()),
        leaf(wait),
        tree(
            overdue("task-1"),
            vec![leaf({
                let mut under = commitment;
                under.id = "commitment-2".to_string();
                under
            })],
        ),
    ]);
    let (sections, rest) = parts(
        &rows,
        Sections {
            overdue: true,
            ..Sections::default()
        },
    );
    assert_eq!(
        sections,
        [(
            Section::Overdue,
            vec![
                "expectation-1".to_string(),
                "task-1".to_string(),
                "commitment-2".to_string()
            ]
        )]
    );
    assert_eq!(rest, ["commitment-1"]);
}

#[test]
fn an_overdue_row_stays_put_when_the_section_is_not_asked_for() {
    let rows = board(vec![leaf(task("task-1")), leaf(overdue("task-2"))]);
    let (sections, rest) = parts(&rows, ASYNC_ONLY);
    assert!(sections.is_empty());
    assert_eq!(rest, ["task-1", "task-2"]);
}

#[test]
fn overdue_is_drawn_under_start_with_the_setting_on_and_nowhere_else() {
    let start = BoardFilter::preset(Preset::Start);
    assert!(shows_overdue(true, &start));
    assert!(!shows_overdue(false, &start));
    for preset in [Preset::All, Preset::Plan, Preset::Do, Preset::Backlog] {
        assert!(
            !shows_overdue(true, &BoardFilter::preset(preset)),
            "{preset:?}"
        );
    }
    let unblock = BoardFilter {
        unblock: true,
        ..start.clone()
    };
    let expectations = BoardFilter {
        expectations: true,
        ..start
    };
    assert!(!shows_overdue(true, &unblock));
    assert!(!shows_overdue(true, &expectations));
}

#[test]
fn review_is_drawn_under_start_and_do_but_not_under_the_list_only_options() {
    assert!(shows_review(&BoardFilter::preset(Preset::Start)));
    assert!(shows_review(&BoardFilter::preset(Preset::Do)));
    assert!(!shows_review(&BoardFilter::preset(Preset::Plan)));
    let unblock = BoardFilter {
        unblock: true,
        ..BoardFilter::preset(Preset::Do)
    };
    assert!(!shows_review(&unblock));
}
