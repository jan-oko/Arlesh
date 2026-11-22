//! Tauri commands that answer the rules the frontend draws by.
//!
//! The rules live in Rust (`arlesh-rules`); the frontend holds none. What it needs from them
//! arrives here as data: the tables that do not change (`rule_tables`, read once at start) and the
//! Plan View's triage (`plan_triage`, read as the scope or the board changes). Every command is
//! pure: it reads its arguments and nothing else, so it works the same in either mode.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    nodes::{kind::NodeKind, rules::parenting::parents_of},
    scopes::key::ScopeKey,
    tasks::{
        model::TimeScope,
        rules::plan::{take_out, triage, PlanAncestor, PlanRefusal, PlanRow, TakeOut},
    },
};

/// The tables of rules that never change while the app runs.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleTables {
    /// For every kind, the kinds it may hang directly under (`nodes::rules::parenting`).
    pub parenting: Vec<ParentingRow>,
    /// Where work taken out of the Plan View's planned pane lands, for every case
    /// (`tasks::rules::plan::take_out`).
    pub take_out: Vec<TakeOutCase>,
}

/// One column of the parenting table.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ParentingRow {
    /// The kind of the node that hangs.
    pub child: NodeKind,
    /// The kinds it may hang directly under.
    pub parents: Vec<NodeKind>,
}

/// One case of the take-out table.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TakeOutCase {
    /// Whether the planned pane is split by subscope.
    pub split: bool,
    /// Whether the scope being filled has a parent.
    pub has_parent: bool,
    /// Where the work lands: `filled`, `parent` or `clear`.
    pub lands: &'static str,
}

/// The tables of rules that never change while the app runs.
pub fn rule_tables_now() -> RuleTables {
    let take_out_case = |split: bool, has_parent: bool| TakeOutCase {
        split,
        has_parent,
        lands: match take_out(split, "filled", has_parent.then_some("parent")) {
            TakeOut::Plan(landing) => landing,
            TakeOut::Clear => "clear",
        },
    };
    RuleTables {
        parenting: NodeKind::ALL
            .into_iter()
            .map(|child| ParentingRow {
                child,
                parents: parents_of(child),
            })
            .collect(),
        take_out: vec![
            take_out_case(true, true),
            take_out_case(true, false),
            take_out_case(false, true),
            take_out_case(false, false),
        ],
    }
}

/// The tables of rules that never change while the app runs: which kinds may hold which, and where
/// taken-out work lands. Read once before the first render.
#[tauri::command]
pub fn rule_tables() -> RuleTables {
    rule_tables_now()
}

/// What a planning pass reads off one ancestor of a row.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAncestorInput {
    /// Its own Time Scope.
    #[serde(default)]
    time_scope: Option<TimeScope>,
}

/// One row a planning pass reads, in the board's camelCase.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRowInput {
    /// The row's id, which the heaps are made of.
    id: String,
    /// Whether the row is drawn but not stored: it has nowhere to write a Plan.
    #[serde(default)]
    r#virtual: bool,
    /// Its own Time Scope.
    #[serde(default)]
    time_scope: Option<TimeScope>,
    /// Its own Plan.
    #[serde(default)]
    plan: Option<TimeScope>,
    /// The Plan it inherits.
    #[serde(default)]
    inherited_plan: Option<TimeScope>,
    /// Whether something above it is planned but that Plan comes to nothing inside its window.
    #[serde(default)]
    empty_plan: bool,
    /// Whether it is Overdue.
    #[serde(default)]
    overdue: bool,
    /// Its ancestors, root first.
    #[serde(default)]
    ancestors: Vec<PlanAncestorInput>,
}

impl From<PlanRowInput> for PlanRow {
    fn from(input: PlanRowInput) -> Self {
        PlanRow {
            id: input.id,
            stored: !input.r#virtual,
            time_scope: input.time_scope,
            plan: input.plan,
            inherited_plan: input.inherited_plan,
            empty_plan: input.empty_plan,
            overdue: input.overdue,
            ancestors: input
                .ancestors
                .into_iter()
                .map(|ancestor| PlanAncestor {
                    time_scope: ancestor.time_scope,
                })
                .collect(),
        }
    }
}

/// What one planning pass makes of the rows.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanTriageAnswer {
    /// Unplanned rows relevant to the scope, by id.
    pub unplanned: Vec<String>,
    /// Rows already planned into the scope.
    pub planned: Vec<String>,
    /// Rows planned to the scope's parent.
    pub parent_planned: Vec<String>,
    /// The rows planning into the scope would be refused, by id and the bound they break
    /// (`own_time_scope` or `parent_plan`). A row that may be planned there is absent.
    pub refusals: BTreeMap<String, PlanRefusal>,
}

/// The bound each of `rows` would break were it planned into `target`, by id; a row that may be
/// planned there is absent.
pub fn plan_refusals_now(target: &ScopeKey, rows: &[PlanRow]) -> BTreeMap<String, PlanRefusal> {
    let window = target.bounds();
    rows.iter()
        .filter_map(|row| Some((row.id.clone(), row.refusal(window)?)))
        .collect()
}

/// The Plan View's triage of `rows` for the scope `target`, whose parent is `parent` (none for a
/// Season), and the bound each row would break there (`tasks::rules::plan`).
pub fn plan_triage_now(
    target: &ScopeKey,
    parent: Option<&ScopeKey>,
    rows: Vec<PlanRowInput>,
) -> PlanTriageAnswer {
    let rows: Vec<PlanRow> = rows.into_iter().map(PlanRow::from).collect();
    let panes = triage(&rows, target.bounds(), parent);
    let ids = |heap: Vec<&PlanRow>| heap.into_iter().map(|row| row.id.clone()).collect();
    PlanTriageAnswer {
        unplanned: ids(panes.unplanned),
        planned: ids(panes.planned),
        parent_planned: ids(panes.parent_planned),
        refusals: plan_refusals_now(target, &rows),
    }
}

/// The Plan View's triage of the rows for the scope being filled, and which rows planning into it
/// would break a bound on. A pure command: it asks `tasks::rules::plan`, which the writer asks.
#[tauri::command]
pub fn plan_triage(
    target: ScopeKey,
    parent: Option<ScopeKey>,
    rows: Vec<PlanRowInput>,
) -> PlanTriageAnswer {
    plan_triage_now(&target, parent.as_ref(), rows)
}

/// Which bound planning each of the rows into `target` would break, by id: the move the Plan View
/// makes into a scope other than the one it is filling (a part of it, say). Pure.
#[tauri::command]
pub fn plan_refusals(target: ScopeKey, rows: Vec<PlanRowInput>) -> BTreeMap<String, PlanRefusal> {
    let rows: Vec<PlanRow> = rows.into_iter().map(PlanRow::from).collect();
    plan_refusals_now(&target, &rows)
}

#[cfg(test)]
mod tests;
