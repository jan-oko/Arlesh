//! The status presets, replayed from the shared conformance corpus.
//!
//! `conformance/preset-filters.json` at the repository root is the specification written as data:
//! a board, a filter, and the nodes each surface keeps. This runs every case through
//! [`arlesh_lib::filters`]; `src/utils/preset-conformance.test.ts` runs the same cases through the
//! frontend's own predicates. Neither side generates the file, so a rule changed in one language
//! and not the other turns the other language red on the case it broke.
//!
//! This is the whole point of the port. The frontend cannot call into Rust on its filter path —
//! it is synchronous and runs per render — so "one definition" has to mean one *specification*
//! both evaluators are held to, rather than one call stack.

use std::collections::{BTreeSet, HashMap};

use arlesh_lib::filters::{
    list,
    model::{
        BoardFilter, NodeKind, OverrideMode, Preset, ScopeAxis, ScopeFilter, ScopeMatch, TagFilter,
        TagMode,
    },
    tree::{self, FactNode},
};
use serde::Deserialize;

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/preset-filters.json"
));

#[derive(Debug, Deserialize)]
struct Corpus {
    cases: Vec<Case>,
    boards: HashMap<String, FactNode>,
}

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    /// The specification sentence the case comes from. Read by whoever is looking at a failure,
    /// which is exactly when it earns its place.
    #[allow(dead_code)]
    spec: String,
    filter: CorpusFilter,
    board: String,
    mindmap: Vec<String>,
    list: Vec<String>,
    commitments: Vec<String>,
}

/// A corpus filter. Spelled the way the frontend spells its own filter state, and converted here,
/// so that the file reads as one vocabulary rather than two.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusFilter {
    preset: Preset,
    #[serde(default)]
    unblock: bool,
    #[serde(default = "yes")]
    include_flows: bool,
    #[serde(default)]
    tags: Vec<CorpusTag>,
    #[serde(default = "yes")]
    show_info: bool,
    #[serde(default = "yes")]
    show_flow: bool,
    #[serde(default)]
    private_mode: bool,
    #[serde(default)]
    archived: OverrideMode,
    #[serde(default)]
    backlog: OverrideMode,
    /// The scope selector. Absent is "any scope", which is what every case written before it had.
    #[serde(default)]
    scope: Option<ScopeFilter>,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusTag {
    tag_id: i64,
    mode: TagMode,
}

impl From<&CorpusFilter> for BoardFilter {
    fn from(filter: &CorpusFilter) -> Self {
        Self {
            preset: filter.preset,
            unblock: filter.unblock,
            include_flows: filter.include_flows,
            tags: filter
                .tags
                .iter()
                .map(|tag| TagFilter {
                    tag_id: tag.tag_id,
                    mode: tag.mode,
                })
                .collect(),
            show_info: filter.show_info,
            show_flow: filter.show_flow,
            private_mode: filter.private_mode,
            archived: filter.archived,
            backlog: filter.backlog,
            scope: filter.scope,
        }
    }
}

/// Fills in `has_todo_child` from the board itself.
///
/// The corpus never states it: it is a fact *about a node's children*, so writing it beside them
/// would let a board say one thing and mean another, and both evaluators would then be agreeing
/// about a fiction.
fn derive_todo_children(node: &mut FactNode) {
    node.facts.has_todo_child = node.children.iter().any(|child| {
        child.facts.kind == NodeKind::Task && child.facts.status.as_deref() == Some("todo")
    });
    for child in &mut node.children {
        derive_todo_children(child);
    }
}

fn sorted(ids: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut ids: Vec<String> = ids.into_iter().collect();
    ids.sort();
    ids
}

#[test]
fn every_case_agrees_with_the_shared_corpus() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    assert!(!corpus.cases.is_empty(), "the corpus has cases");

    for case in &corpus.cases {
        let mut root = corpus
            .boards
            .get(&case.board)
            .unwrap_or_else(|| panic!("{}: no board named {}", case.name, case.board))
            .clone();
        derive_todo_children(&mut root);
        let filter = BoardFilter::from(&case.filter);

        let pruned = tree::prune_tree(&root, &filter);
        let mindmap: BTreeSet<String> = tree::kept_ids(&pruned)
            .into_iter()
            .filter(|id| id != &root.facts.id)
            .collect();
        assert_eq!(
            mindmap.into_iter().collect::<Vec<_>>(),
            sorted(case.mindmap.clone()),
            "{}: the Mindmap kept different nodes",
            case.name
        );

        let rows = list::flatten(&root, NodeKind::Task);
        let kept_rows = rows
            .iter()
            .filter(|row| list::passes_row(row.as_row(), &filter))
            .map(|row| row.node.id.clone());
        assert_eq!(
            sorted(kept_rows),
            sorted(case.list.clone()),
            "{}: the List View kept different task rows",
            case.name
        );

        let commitments = list::flatten(&root, NodeKind::Commitment);
        let kept_commitments = commitments
            .iter()
            .filter(|row| list::passes_commitment_row(row.as_row(), &filter))
            .map(|row| row.node.id.clone());
        assert_eq!(
            sorted(kept_commitments),
            sorted(case.commitments.clone()),
            "{}: the commitments band kept different rows",
            case.name
        );
    }
}

#[test]
fn every_preset_is_covered() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    // A preset with no case is a preset nothing holds the two implementations to, which is the one
    // failure this whole corpus exists to prevent.
    for preset in [
        Preset::All,
        Preset::Plan,
        Preset::Start,
        Preset::Do,
        Preset::Backlog,
    ] {
        assert!(
            corpus
                .cases
                .iter()
                .any(|case| case.filter.preset == preset && !case.filter.unblock),
            "no case covers {preset:?}"
        );
    }
    assert!(
        corpus.cases.iter().any(|case| case.filter.unblock),
        "no case covers Unblock"
    );
}

#[test]
fn every_axis_and_match_combination_is_covered() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    // Four combinations, and the disagreements a scope filter can hide are between *pairs* of
    // them — Within against Overlapping on the same axis, Relevance against Plan under the same
    // match. A combination with no case is one neither evaluator is held to.
    for axis in [ScopeAxis::Relevance, ScopeAxis::Plan] {
        for rule in [ScopeMatch::Within, ScopeMatch::Overlapping] {
            assert!(
                corpus.cases.iter().any(|case| {
                    case.filter
                        .scope
                        .is_some_and(|scope| scope.axis == axis && scope.match_rule == rule)
                }),
                "no case covers {axis:?} x {rule:?}"
            );
        }
    }
}
