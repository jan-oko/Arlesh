//! The List View's lifted sections, replayed from the shared conformance corpus.
//!
//! `conformance/list-sections.json` is the specification written as data: a board, the sections
//! asked for, and the rows each takes. This runs every case through
//! [`arlesh_lib::filters::sections`]; `src/utils/list-sections-conformance.test.ts` runs the same
//! cases through the frontend's `list-sections.ts`. Neither side generates the file.

use std::collections::HashMap;

use arlesh_lib::filters::{
    list,
    model::{BoardFilter, NodeKind, Preset},
    sections::{self, Section, Sections},
    tree::FactNode,
};
use serde::Deserialize;

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/list-sections.json"
));

#[derive(Debug, Deserialize)]
struct Corpus {
    cases: Vec<Case>,
    drawn: Vec<Drawn>,
    boards: HashMap<String, FactNode>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Asked {
    review: bool,
    overdue: bool,
    asynchronous: bool,
}

#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(default)]
struct Expect {
    review: Option<Vec<String>>,
    overdue: Option<Vec<String>>,
    asynchronous: Option<Vec<String>>,
    rest: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    board: String,
    sections: Asked,
    #[serde(default)]
    rows: Option<Vec<String>>,
    expect: Expect,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrawnFilter {
    preset: Preset,
    #[serde(default)]
    unblock: bool,
    #[serde(default)]
    expectations: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Drawn {
    name: String,
    filter: DrawnFilter,
    overdue_setting: bool,
    review: bool,
    overdue: bool,
}

fn ids(rows: &[&list::OwnedRow]) -> Vec<String> {
    rows.iter().map(|row| row.node.id.clone()).collect()
}

#[test]
fn every_case_partitions_as_the_corpus_says() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    assert!(!corpus.cases.is_empty(), "the corpus has cases");
    for case in &corpus.cases {
        let root = corpus
            .boards
            .get(&case.board)
            .unwrap_or_else(|| panic!("{}: no board named {}", case.name, case.board));
        let mut rows = list::flatten_kinds(
            root,
            &[NodeKind::Task, NodeKind::Commitment, NodeKind::Expectation],
        );
        if let Some(kept) = &case.rows {
            rows.retain(|row| kept.contains(&row.node.id));
        }
        let asked = Sections {
            review: case.sections.review,
            overdue: case.sections.overdue,
            asynchronous: case.sections.asynchronous,
        };
        let partition = sections::partition(&rows, asked);
        let mut got = Expect {
            rest: ids(&partition.rest),
            ..Expect::default()
        };
        for (section, rows) in &partition.sections {
            let slot = match section {
                Section::Review => &mut got.review,
                Section::Overdue => &mut got.overdue,
                Section::Asynchronous => &mut got.asynchronous,
            };
            *slot = Some(ids(rows));
        }
        assert_eq!(got, case.expect, "{}", case.name);
    }
}

#[test]
fn every_case_draws_the_sections_the_corpus_says() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    assert!(!corpus.drawn.is_empty(), "the corpus has drawn cases");
    for case in &corpus.drawn {
        let filter = BoardFilter {
            unblock: case.filter.unblock,
            expectations: case.filter.expectations,
            ..BoardFilter::preset(case.filter.preset)
        };
        assert_eq!(
            sections::shows_review(&filter),
            case.review,
            "{}: review",
            case.name
        );
        assert_eq!(
            sections::shows_overdue(case.overdue_setting, &filter),
            case.overdue,
            "{}: overdue",
            case.name
        );
    }
}
