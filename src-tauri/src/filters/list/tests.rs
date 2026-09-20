//! Flat rows: the ancestor walks that stand in for a tree the list does not have.

use super::*;
use crate::filters::{
    model::{NodeFacts, OverrideMode},
    tree::FactNode,
};
use crate::tasks::{lifecycle::Timing, model::Verdict};

fn task(id: &str, status: &str) -> NodeFacts {
    let mut facts = NodeFacts::new(id, crate::filters::model::NodeKind::Task);
    facts.status = Some(status.to_string());
    facts
}

fn rows_of(root: &FactNode, filter: &BoardFilter) -> Vec<String> {
    flatten(root, NodeKind::Task)
        .into_iter()
        .filter(|row| passes_row(row.as_row(), filter))
        .map(|row| row.node.id)
        .collect()
}

#[test]
fn the_frame_is_neither_a_row_nor_an_ancestor() {
    let root = FactNode::with_children(
        task("task-frame", "todo"),
        vec![FactNode::leaf(task("task-1", "todo"))],
    );
    let rows = flatten(&root, NodeKind::Task);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].node.id, "task-1");
    assert!(rows[0].ancestors.is_empty());
}

#[test]
fn a_shelved_project_above_a_row_takes_the_row_with_it() {
    let mut frozen = NodeFacts::new("domain-1", NodeKind::Project);
    frozen.status = Some("frozen".to_string());
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![FactNode::with_children(
            frozen,
            vec![FactNode::leaf(task("task-1", "todo"))],
        )],
    );
    assert!(rows_of(&root, &BoardFilter::preset(Preset::Plan)).is_empty());
    assert_eq!(rows_of(&root, &BoardFilter::preset(Preset::All)), ["task-1"]);
}

#[test]
fn a_backlogged_ancestor_takes_the_row_with_it_and_backlog_brings_it_back() {
    let mut set_aside = task("task-1", "todo");
    set_aside.backlogged = true;
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![FactNode::with_children(
            set_aside,
            vec![FactNode::leaf(task("task-2", "todo"))],
        )],
    );
    assert!(rows_of(&root, &BoardFilter::preset(Preset::Plan)).is_empty());
    assert_eq!(
        rows_of(&root, &BoardFilter::preset(Preset::Backlog)),
        ["task-1", "task-2"]
    );
}

#[test]
fn a_blocked_ancestor_takes_the_row_out_of_start() {
    let mut blocked = task("task-1", "todo");
    blocked.is_blocked = true;
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![FactNode::with_children(
            blocked,
            vec![FactNode::leaf(task("task-2", "todo"))],
        )],
    );
    assert!(rows_of(&root, &BoardFilter::preset(Preset::Start)).is_empty());
}

#[test]
fn an_unopened_occurrence_above_a_row_takes_the_row_with_it() {
    let mut unopened = task("task-1", "todo");
    unopened.is_habit_occurrence = true;
    unopened.timing = Some(Timing::Pending);
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![FactNode::with_children(
            unopened,
            vec![FactNode::leaf(task("task-2", "todo"))],
        )],
    );
    assert!(rows_of(&root, &BoardFilter::preset(Preset::Plan)).is_empty());
    assert_eq!(
        rows_of(&root, &BoardFilter::preset(Preset::All)),
        ["task-1", "task-2"]
    );
}

#[test]
fn a_private_ancestor_hides_a_row_that_is_not_itself_private() {
    let mut private = NodeFacts::new("domain-1", NodeKind::Domain);
    private.is_private = true;
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![FactNode::with_children(
            private,
            vec![FactNode::leaf(task("task-1", "todo"))],
        )],
    );
    assert!(rows_of(&root, &BoardFilter::default()).is_empty());
    assert_eq!(
        rows_of(
            &root,
            &BoardFilter {
                private_mode: true,
                ..BoardFilter::default()
            }
        ),
        ["task-1"]
    );
}

#[test]
fn unblock_keeps_the_blocked_rows_and_only_those() {
    let mut blocked = task("task-1", "todo");
    blocked.is_blocked = true;
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![
            FactNode::leaf(blocked),
            FactNode::leaf(task("task-2", "todo")),
        ],
    );
    let filter = BoardFilter {
        unblock: true,
        ..BoardFilter::preset(Preset::All)
    };
    assert_eq!(rows_of(&root, &filter), ["task-1"]);
}

#[test]
fn unblock_over_start_empties_the_list_it_was_meant_to_fill() {
    // The divergence named on `passes_row`, pinned so a future change to it is deliberate.
    let mut blocked = task("task-1", "todo");
    blocked.is_blocked = true;
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![FactNode::leaf(blocked)],
    );
    let filter = BoardFilter {
        unblock: true,
        ..BoardFilter::preset(Preset::Start)
    };
    assert!(rows_of(&root, &filter).is_empty());
}

fn commitment(id: &str, verdict: Verdict, timing: Timing) -> NodeFacts {
    let mut facts = NodeFacts::new(id, NodeKind::Commitment);
    facts.verdict = Some(verdict);
    facts.timing = Some(timing);
    facts
}

fn commitment_rows(root: &FactNode, filter: &BoardFilter) -> Vec<String> {
    flatten(root, NodeKind::Commitment)
        .into_iter()
        .filter(|row| passes_commitment_row(row.as_row(), filter))
        .map(|row| row.node.id)
        .collect()
}

#[test]
fn the_commitments_band_answers_the_commitment_rules() {
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![
            FactNode::leaf(commitment("commitment-1", Verdict::Unresolved, Timing::Active)),
            FactNode::leaf(commitment("commitment-2", Verdict::Kept, Timing::Active)),
            FactNode::leaf(commitment("commitment-3", Verdict::Broken, Timing::Active)),
        ],
    );
    assert_eq!(
        commitment_rows(&root, &BoardFilter::preset(Preset::All)),
        ["commitment-1", "commitment-2", "commitment-3"]
    );
    assert_eq!(
        commitment_rows(&root, &BoardFilter::preset(Preset::Plan)),
        ["commitment-1", "commitment-3"]
    );
    assert_eq!(
        commitment_rows(&root, &BoardFilter::preset(Preset::Do)),
        ["commitment-1"]
    );
}

#[test]
fn unblock_and_backlog_both_empty_the_commitments_band() {
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![FactNode::leaf(commitment(
            "commitment-1",
            Verdict::Unresolved,
            Timing::Active,
        ))],
    );
    assert!(commitment_rows(&root, &BoardFilter::preset(Preset::Backlog)).is_empty());
    assert!(commitment_rows(
        &root,
        &BoardFilter {
            unblock: true,
            ..BoardFilter::preset(Preset::All)
        }
    )
    .is_empty());
}

#[test]
fn a_shelved_project_above_the_band_empties_it_too() {
    let mut frozen = NodeFacts::new("domain-1", NodeKind::Project);
    frozen.status = Some("frozen".to_string());
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![FactNode::with_children(
            frozen,
            vec![FactNode::leaf(commitment(
                "commitment-1",
                Verdict::Unresolved,
                Timing::Active,
            ))],
        )],
    );
    assert!(commitment_rows(&root, &BoardFilter::preset(Preset::Plan)).is_empty());
}

#[test]
fn the_archived_pill_on_include_reaches_a_commitment_too() {
    let mut archived = commitment("commitment-1", Verdict::Kept, Timing::Lapsed);
    archived.archived = true;
    let root = FactNode::with_children(
        NodeFacts::new("root", NodeKind::Aspect),
        vec![FactNode::leaf(archived)],
    );
    assert!(commitment_rows(&root, &BoardFilter::preset(Preset::Plan)).is_empty());
    assert_eq!(
        commitment_rows(
            &root,
            &BoardFilter {
                archived: OverrideMode::Include,
                ..BoardFilter::preset(Preset::Plan)
            }
        ),
        ["commitment-1"]
    );
}
