//! The relative cycle grid, replayed from the shared conformance corpus.
//!
//! `conformance/flow-cycles.json` writes down the nominal subdivisions, the navigator's levels and
//! the flat index a path names. This runs it through [`arlesh_lib::flows::rules::cycle_grid`];
//! `src/utils/flow-cycles-conformance.test.ts` runs it through the editor's `flow-cycle.ts`.
//! Neither side generates the file.

use arlesh_lib::{
    flows::rules::cycle_grid::{cycle_levels, path_to_index, subdivisions_between, CycleLevel},
    scopes::model::ScopeKind,
};
use serde::Deserialize;

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/flow-cycles.json"
));

#[derive(Debug, Deserialize)]
struct Subdivision {
    parent: ScopeKind,
    child: ScopeKind,
    count: i64,
}

#[derive(Debug, Deserialize)]
struct Level {
    kind: ScopeKind,
    count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Levels {
    flow_n: i64,
    flow_kind: ScopeKind,
    target: ScopeKind,
    levels: Vec<Level>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Path {
    flow_n: i64,
    flow_kind: ScopeKind,
    target: ScopeKind,
    path: Vec<i64>,
    index: i64,
}

#[derive(Debug, Deserialize)]
struct Corpus {
    subdivisions: Vec<Subdivision>,
    levels: Vec<Levels>,
    paths: Vec<Path>,
}

#[test]
fn every_case_agrees_with_the_shared_corpus() {
    let corpus: Corpus = serde_json::from_str(CORPUS).expect("the corpus parses");
    for case in &corpus.subdivisions {
        assert_eq!(
            subdivisions_between(case.parent, case.child),
            case.count,
            "{:?} in {:?}",
            case.child,
            case.parent
        );
    }
    for case in &corpus.levels {
        let expected: Vec<CycleLevel> = case
            .levels
            .iter()
            .map(|level| CycleLevel {
                kind: level.kind,
                count: level.count,
            })
            .collect();
        assert_eq!(
            cycle_levels(case.flow_n, case.flow_kind, case.target),
            expected,
            "{} {:?} down to {:?}",
            case.flow_n,
            case.flow_kind,
            case.target
        );
    }
    for case in &corpus.paths {
        let levels = cycle_levels(case.flow_n, case.flow_kind, case.target);
        assert_eq!(
            path_to_index(&levels, &case.path),
            case.index,
            "{:?}",
            case.path
        );
    }
}
