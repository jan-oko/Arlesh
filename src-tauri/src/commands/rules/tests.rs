//! The rule commands answer the shared conformance corpora: what the frontend reads as data is what
//! `conformance/plan-triage.json` and `conformance/parenting.json` write down.

use super::*;
use serde_json::{from_value, Value};

const PLAN_CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/plan-triage.json"
));
const PARENTING_CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/parenting.json"
));

fn corpus(text: &str) -> Value {
    serde_json::from_str(text).expect("the corpus parses")
}

fn ids(value: &Value) -> Vec<String> {
    from_value(value.clone()).expect("a list of ids")
}

fn rows(value: &Value) -> Vec<PlanRowInput> {
    from_value(value.clone()).expect("rows")
}

#[test]
fn plan_triage_answers_every_triage_case_of_the_corpus() {
    let corpus = corpus(PLAN_CORPUS);
    let cases = corpus["triage"].as_array().expect("cases");
    assert!(!cases.is_empty());
    for case in cases {
        let target: ScopeKey = from_value(case["target"].clone()).expect("a scope");
        let parent: Option<ScopeKey> = from_value(case["parent"].clone()).expect("a parent");

        let answer = plan_triage_now(&target, parent.as_ref(), rows(&case["rows"]));

        assert_eq!(
            answer.unplanned,
            ids(&case["unplanned"]),
            "{}",
            case["name"]
        );
        assert_eq!(answer.planned, ids(&case["planned"]), "{}", case["name"]);
        assert_eq!(
            answer.parent_planned,
            ids(&case["parentPlanned"]),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn the_refusals_answer_every_refusal_case_of_the_corpus() {
    let corpus = corpus(PLAN_CORPUS);
    let cases = corpus["refusals"].as_array().expect("cases");
    assert!(!cases.is_empty());
    for case in cases {
        let target: ScopeKey = from_value(case["target"].clone()).expect("a scope");
        let row: PlanRowInput = from_value(case["row"].clone()).expect("a row");
        let id = case["row"]["id"].as_str().expect("an id").to_string();
        let expected = match case["refusal"].as_str() {
            Some("ownTimeScope") => Some(PlanRefusal::OwnTimeScope),
            Some("parentPlan") => Some(PlanRefusal::ParentPlan),
            None => None,
            Some(other) => panic!("unknown refusal {other}"),
        };

        let refusals = plan_refusals_now(&target, &[PlanRow::from(row)]);

        assert_eq!(refusals.get(&id).copied(), expected, "{}", case["name"]);
    }
}

#[test]
fn a_triage_answer_carries_the_refusals_of_its_target() {
    let corpus = corpus(PLAN_CORPUS);
    let case = &corpus["refusals"][0];
    let target: ScopeKey = from_value(case["target"].clone()).expect("a scope");
    let rows = vec![from_value(case["row"].clone()).expect("a row")];

    let answer = plan_triage_now(&target, None, rows);

    assert_eq!(answer.refusals.len(), 1);
}

#[test]
fn the_take_out_table_is_the_corpus_table() {
    let corpus = corpus(PLAN_CORPUS);
    let tables = rule_tables_now();

    for case in corpus["takeOut"].as_array().expect("cases") {
        let found = tables.take_out.iter().find(|row| {
            Some(row.split) == case["split"].as_bool()
                && Some(row.has_parent) == case["hasParent"].as_bool()
        });
        assert_eq!(found.map(|row| row.lands), case["lands"].as_str(), "{case}");
    }
}

#[test]
fn the_parenting_table_is_the_corpus_matrix() {
    let corpus = corpus(PARENTING_CORPUS);
    let tables = rule_tables_now();

    for row in &tables.parenting {
        let kind = serde_json::to_value(row.child).expect("a kind");
        let expected: Vec<NodeKind> =
            from_value(corpus["parents"][kind.as_str().expect("text")].clone()).expect("parents");
        assert_eq!(row.parents, expected, "{kind}");
    }
    assert_eq!(
        tables.parenting.len(),
        corpus["kinds"].as_array().expect("kinds").len()
    );
}
