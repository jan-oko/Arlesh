//! The two Task status models and their conversion, replayed from the shared conformance corpus.
//!
//! `conformance/task-status.json` writes every status of both models down with its counterpart in
//! each. This runs every case through [`Status::converted`]; `src/utils/task-status-conformance.test.ts`
//! runs them through the editor's `convertedStatus`. Neither side generates the file.

use arlesh_lib::tasks::model::{AgenticStatus, Status, TaskStatus};
use serde::Deserialize;

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/task-status.json"
));

#[derive(Debug, Deserialize)]
struct Models {
    ordinary: Vec<TaskStatus>,
    agentic: Vec<AgenticStatus>,
}

#[derive(Debug, Deserialize)]
struct Case {
    status: Status,
    agentic: bool,
    converted: Option<Status>,
}

#[derive(Debug, Deserialize)]
struct Corpus {
    models: Models,
    cases: Vec<Case>,
}

#[test]
fn every_status_converts_as_the_corpus_says() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    for case in &corpus.cases {
        assert_eq!(
            case.status.converted(case.agentic),
            case.converted,
            "{:?} into the {} model",
            case.status,
            if case.agentic { "Agentic" } else { "ordinary" }
        );
    }
}

#[test]
fn every_status_of_both_models_has_a_case_into_each() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    let statuses = corpus
        .models
        .ordinary
        .iter()
        .map(|status| Status::Ordinary(*status))
        .chain(
            corpus
                .models
                .agentic
                .iter()
                .map(|status| Status::Agentic(*status)),
        );
    for status in statuses {
        for agentic in [false, true] {
            assert!(
                corpus
                    .cases
                    .iter()
                    .any(|case| case.status == status && case.agentic == agentic),
                "{status:?} into agentic={agentic} has no case"
            );
        }
    }
}
