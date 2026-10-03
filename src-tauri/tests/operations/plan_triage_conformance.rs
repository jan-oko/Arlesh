//! The Plan View's rules, replayed from the shared conformance corpus.
//!
//! `conformance/plan-triage.json` writes down the heaps a planning pass makes, the bound a move
//! breaks, the scope one rung up and where work taken out lands. This runs it through
//! [`arlesh_lib::tasks::rules::plan`], whose bounds are the writer's own containment check;
//! `src/utils/plan-triage-conformance.test.ts` runs it through the Plan View's own modules. Neither
//! side generates the file.

use arlesh_lib::{
    scopes::key::ScopeKey,
    tasks::{
        model::TimeScope,
        rules::plan::{
            parent_of, split, take_out, triage, PlanAncestor, PlanRefusal, PlanRow, TakeOut,
        },
    },
};
use serde::Deserialize;

const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../conformance/plan-triage.json"
));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusAncestor {
    #[serde(default)]
    time_scope: Option<TimeScope>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusRow {
    id: String,
    #[serde(default)]
    time_scope: Option<TimeScope>,
    #[serde(default)]
    plan: Option<TimeScope>,
    #[serde(default)]
    inherited_plan: Option<TimeScope>,
    #[serde(default)]
    empty_plan: bool,
    #[serde(default)]
    overdue: bool,
    #[serde(default, rename = "virtual")]
    drawing: bool,
    #[serde(default)]
    ancestors: Vec<CorpusAncestor>,
}

impl CorpusRow {
    fn row(&self) -> PlanRow {
        PlanRow {
            id: self.id.clone(),
            stored: !self.drawing,
            time_scope: self.time_scope.clone(),
            plan: self.plan.clone(),
            inherited_plan: self.inherited_plan.clone(),
            empty_plan: self.empty_plan,
            overdue: self.overdue,
            ancestors: self
                .ancestors
                .iter()
                .map(|ancestor| PlanAncestor {
                    time_scope: ancestor.time_scope.clone(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Triage {
    name: String,
    target: ScopeKey,
    parent: Option<ScopeKey>,
    rows: Vec<CorpusRow>,
    unplanned: Vec<String>,
    planned: Vec<String>,
    parent_planned: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Refusal {
    name: String,
    row: CorpusRow,
    target: ScopeKey,
    refusal: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Parent {
    scope: ScopeKey,
    parent: Option<ScopeKey>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TakeOutCase {
    split: bool,
    has_parent: bool,
    lands: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Section {
    cell: ScopeKey,
    partial: bool,
    rows: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sections {
    name: String,
    target: ScopeKey,
    include_premorning: bool,
    rows: Vec<CorpusRow>,
    sections: Vec<Section>,
    unplaced: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopeDates {
    key: ScopeKey,
    start_date: chrono::NaiveDate,
    end_date: chrono::NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    triage: Vec<Triage>,
    refusals: Vec<Refusal>,
    parents: Vec<Parent>,
    take_out: Vec<TakeOutCase>,
    sections: Vec<Sections>,
    scopes: Vec<ScopeDates>,
}

fn ids(rows: &[&PlanRow]) -> Vec<String> {
    rows.iter().map(|row| row.id.clone()).collect()
}

fn corpus() -> Corpus {
    serde_json::from_str(CORPUS).expect("the corpus parses")
}

#[test]
fn every_pass_splits_the_rows_as_the_corpus_says() {
    for case in corpus().triage {
        let rows: Vec<PlanRow> = case.rows.iter().map(CorpusRow::row).collect();
        assert_eq!(
            parent_of(&case.target),
            case.parent,
            "{}: parent",
            case.name
        );
        let panes = triage(&rows, case.target.bounds(), case.parent.as_ref());
        assert_eq!(
            ids(&panes.unplanned),
            case.unplanned,
            "{}: unplanned",
            case.name
        );
        assert_eq!(ids(&panes.planned), case.planned, "{}: planned", case.name);
        assert_eq!(
            ids(&panes.parent_planned),
            case.parent_planned,
            "{}: parent-planned",
            case.name
        );
    }
}

#[test]
fn every_move_is_refused_as_the_corpus_says() {
    for case in corpus().refusals {
        let refusal = case
            .row
            .row()
            .refusal(case.target.bounds())
            .map(|refusal| match refusal {
                PlanRefusal::OwnTimeScope => "ownTimeScope",
                PlanRefusal::ParentPlan => "parentPlan",
            });
        assert_eq!(refusal, case.refusal.as_deref(), "{}", case.name);
    }
}

#[test]
fn every_scope_has_the_parent_the_corpus_says() {
    for case in corpus().parents {
        assert_eq!(parent_of(&case.scope), case.parent, "{:?}", case.scope);
    }
}

#[test]
fn work_taken_out_lands_where_the_corpus_says() {
    for case in corpus().take_out {
        let parent = case.has_parent.then_some("parent");
        let lands = match take_out(case.split, "filled", parent) {
            TakeOut::Plan(scope) => scope,
            TakeOut::Clear => "clear",
        };
        assert_eq!(
            lands, case.lands,
            "split={} parent={}",
            case.split, case.has_parent
        );
    }
}

#[test]
fn every_planned_pane_splits_as_the_corpus_says() {
    for case in corpus().sections {
        let rows: Vec<PlanRow> = case.rows.iter().map(CorpusRow::row).collect();
        let planned: Vec<&PlanRow> = rows.iter().collect();
        let Some(split) = split(&planned, &case.target, case.include_premorning) else {
            panic!("{}: the scope has parts", case.name);
        };
        let sections: Vec<(ScopeKey, bool, Vec<String>)> = split
            .sections
            .iter()
            .map(|section| (section.cell, section.partial, ids(&section.rows)))
            .collect();
        let expected: Vec<(ScopeKey, bool, Vec<String>)> = case
            .sections
            .iter()
            .map(|section| (section.cell, section.partial, section.rows.clone()))
            .collect();
        assert_eq!(sections, expected, "{}: sections", case.name);
        assert_eq!(
            ids(&split.unplaced),
            case.unplaced,
            "{}: unplaced",
            case.name
        );
    }
}

#[test]
fn every_scope_spans_the_days_the_corpus_says() {
    for case in corpus().scopes {
        assert_eq!(
            (case.key.start_date(), case.key.end_date()),
            (case.start_date, case.end_date),
            "{:?}",
            case.key
        );
    }
}
