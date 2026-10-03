//! A Window Habit's cooldown options, replayed from the shared conformance corpus.
//!
//! `conformance/cooldown.json` writes down which units each window kind takes and the longest
//! cooldown each allows. This runs it through [`CooldownUnit::allowed_for`] and
//! [`Cooldown::longest`]; `src/utils/cooldown-conformance.test.ts` runs it through the Flow
//! editor's `cooldownKinds` and `maxCooldown`. Neither side generates the file.

use arlesh_lib::flows::rules::cooldown::{Cooldown, CooldownUnit};
use serde::Deserialize;

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/cooldown.json"
));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Units {
    habit_kind: String,
    units: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    habit_kind: String,
    habit_n: i64,
    unit: String,
    longest: i64,
}

#[derive(Debug, Deserialize)]
struct Corpus {
    units: Vec<Units>,
    cases: Vec<Case>,
}

#[test]
fn every_window_kind_takes_the_units_the_corpus_names() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    for entry in &corpus.units {
        let units: Vec<&str> = CooldownUnit::allowed_for(&entry.habit_kind)
            .iter()
            .map(|unit| unit.as_str())
            .collect();
        assert_eq!(units, entry.units, "{}", entry.habit_kind);
    }
}

#[test]
fn every_cooldown_is_bounded_as_the_corpus_says() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    for case in &corpus.cases {
        let unit = CooldownUnit::from_db(&case.unit).expect("a cooldown unit");
        assert_eq!(
            Cooldown::longest(unit, &case.habit_kind, case.habit_n),
            case.longest,
            "{} {} on {} {}",
            case.longest,
            case.unit,
            case.habit_n,
            case.habit_kind
        );
    }
}
