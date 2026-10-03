//! The Habit fold, replayed from the shared conformance corpus.
//!
//! `conformance/habit-fold.json` is the specification written as data: one node's children, and
//! what is drawn in their place. This runs every case through [`arlesh_lib::flows::rules::fold`];
//! `src/utils/habit-fold-conformance.test.ts` runs the same cases through `foldHabitRuns`. Neither
//! side generates the file.

use arlesh_lib::{
    flows::rules::fold::{fold, Child, Folded, Iteration},
    scopes::model::ScopeKind,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/habit-fold.json"
));

#[derive(Debug, Deserialize)]
struct Corpus {
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    threshold: usize,
    children: Vec<CorpusChild>,
    folded: Value,
}

#[derive(Debug, Deserialize)]
struct CorpusChild {
    id: String,
    #[serde(default)]
    flow: Option<i64>,
    #[serde(default)]
    kind: Option<ScopeKind>,
    #[serde(default)]
    anchor: Option<NaiveDate>,
    #[serde(default)]
    passed: bool,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    owed: bool,
}

impl CorpusChild {
    fn child(&self) -> Child<String> {
        match (self.flow, self.anchor) {
            (Some(flow_id), Some(anchor_date)) => Child::Iteration(
                self.id.clone(),
                Iteration {
                    flow_id,
                    scope_kind: self.kind,
                    anchor_date,
                    passed: self.passed,
                    done: self.done,
                    owed: self.owed,
                },
            ),
            _ => Child::Other(self.id.clone()),
        }
    }
}

/// What the corpus writes for a folded child.
fn drawn(folded: &Folded<String>) -> Value {
    match folded {
        Folded::Node(id) => json!(id),
        Folded::Group(group) => json!({
            "id": group.id,
            "level": group.level.map_or("run", |level| level.as_str()),
            "tally": {
                "passed": group.tally.passed,
                "done": group.tally.done,
                "missed": group.tally.missed,
            },
            "children": group.children.iter().map(drawn).collect::<Vec<_>>(),
        }),
    }
}

#[test]
fn every_case_folds_as_the_corpus_says() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    assert!(!corpus.cases.is_empty(), "the corpus has cases");
    for case in &corpus.cases {
        let children = case.children.iter().map(CorpusChild::child).collect();
        let folded: Vec<Value> = fold(children, case.threshold).iter().map(drawn).collect();
        assert_eq!(Value::Array(folded), case.folded, "{}", case.name);
    }
}
