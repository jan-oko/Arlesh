//! The Zen View's contents, replayed from the shared conformance corpus.
//!
//! `conformance/zen-contents.json` is the specification written as data: a board, the tab's filter
//! and options, and what the grid and the strips draw. This runs every case through
//! [`arlesh_lib::filters::zen`]; `src/utils/zen-contents-conformance.test.ts` runs the same cases
//! through the frontend's `zen-contents.ts`. Neither side generates the file.

use std::collections::HashMap;

use arlesh_lib::filters::{
    list,
    model::{BoardFilter, NodeKind, Pill, Preset},
    tree::FactNode,
    views::{self, View},
    zen::{self, ZenOptions, ZenSource},
};
use serde::Deserialize;

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/zen-contents.json"
));

#[derive(Debug, Deserialize)]
struct Corpus {
    cases: Vec<Case>,
    views: Vec<ViewCase>,
    boards: HashMap<String, FactNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusFilter {
    preset: Preset,
    #[serde(default)]
    show_on_agent: bool,
    #[serde(default)]
    show_review: bool,
    #[serde(default)]
    start_hides_checked_waits: bool,
    #[serde(default)]
    private_mode: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct CorpusOptions {
    commitments: bool,
    expectations: bool,
    agentic: Vec<Pill>,
    shows_started: bool,
    shows_compound: bool,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct Expect {
    tasks: Vec<String>,
    commitments: Vec<String>,
    expectations: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    board: String,
    filter: CorpusFilter,
    options: CorpusOptions,
    expect: Expect,
}

#[derive(Debug, Deserialize)]
struct ViewCase {
    view: View,
    locked: Option<Preset>,
}

#[test]
fn every_view_locks_the_preset_the_corpus_says() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    assert_eq!(corpus.views.len(), 5, "every view has a case");
    for case in &corpus.views {
        assert_eq!(
            views::locked_preset(case.view),
            case.locked,
            "{:?}",
            case.view
        );
    }
}

fn ids(rows: &[&list::OwnedRow]) -> Vec<String> {
    rows.iter().map(|row| row.node.id.clone()).collect()
}

#[test]
fn every_case_draws_what_the_corpus_says() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    assert!(!corpus.cases.is_empty(), "the corpus has cases");
    for case in &corpus.cases {
        let root = corpus
            .boards
            .get(&case.board)
            .unwrap_or_else(|| panic!("{}: no board named {}", case.name, case.board));
        let tasks = list::flatten(root, NodeKind::Task);
        let commitments = list::flatten(root, NodeKind::Commitment);
        let expectations = list::flatten(root, NodeKind::Expectation);
        let filter = BoardFilter {
            show_on_agent: case.filter.show_on_agent,
            show_review: case.filter.show_review,
            start_hides_checked_waits: case.filter.start_hides_checked_waits,
            private_mode: case.filter.private_mode,
            ..BoardFilter::preset(case.filter.preset)
        };
        let options = ZenOptions {
            commitments: case.options.commitments,
            expectations: case.options.expectations,
            agentic: case.options.agentic.clone(),
            shows_started: case.options.shows_started,
            shows_compound: case.options.shows_compound,
        };
        let drawn = zen::contents(
            ZenSource {
                tasks: &tasks,
                commitments: &commitments,
                expectations: &expectations,
            },
            &filter,
            &options,
        );
        let got = Expect {
            tasks: ids(&drawn.tasks),
            commitments: ids(&drawn.commitments),
            expectations: ids(&drawn.expectations),
        };
        assert_eq!(got, case.expect, "{}", case.name);
    }
}
