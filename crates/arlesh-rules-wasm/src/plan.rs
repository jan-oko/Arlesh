//! `tasks::rules::plan`: the Plan View's triage, its refusals and where work taken out lands.
//!
//! The rules' own inputs (`PlanRow`) carry no `Deserialize`, by design: they are what persistence
//! gathers, not a wire shape. So this boundary has its own row, in the board's camelCase.

use arlesh_rules::scopes::key::ScopeKey;
use arlesh_rules::tasks::model::TimeScope;
use arlesh_rules::tasks::rules::plan::{
    take_out, triage, PlanAncestor, PlanRefusal, PlanRow, TakeOut,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use crate::wire::{read, write};

/// One ancestor of a row: the Time Scope a row with none of its own inherits.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PlanAncestorInput {
    /// Its own Time Scope.
    #[serde(default)]
    #[tsify(type = "TimeScopeWire | null", optional)]
    time_scope: Option<TimeScope>,
}

/// One row a planning pass reads.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PlanRowInput {
    /// The row's id, which the heaps are made of.
    id: String,
    /// Whether the row is drawn but not stored (a virtual node): it has nowhere to write a Plan.
    #[serde(default)]
    #[tsify(optional)]
    r#virtual: bool,
    /// Its own Time Scope.
    #[serde(default)]
    #[tsify(type = "TimeScopeWire | null", optional)]
    time_scope: Option<TimeScope>,
    /// Its own Plan.
    #[serde(default)]
    #[tsify(type = "TimeScopeWire | null", optional)]
    plan: Option<TimeScope>,
    /// The Plan it inherits.
    #[serde(default)]
    #[tsify(type = "TimeScopeWire | null", optional)]
    inherited_plan: Option<TimeScope>,
    /// Whether something above it is planned but that Plan comes to nothing inside its window.
    #[serde(default)]
    #[tsify(optional)]
    empty_plan: bool,
    /// Whether it is Overdue.
    #[serde(default)]
    #[tsify(optional)]
    overdue: bool,
    /// Its ancestors, root first.
    #[serde(default)]
    #[tsify(optional)]
    ancestors: Vec<PlanAncestorInput>,
}

impl PlanRowInput {
    fn into_row(self) -> PlanRow {
        PlanRow {
            id: self.id,
            stored: !self.r#virtual,
            time_scope: self.time_scope,
            plan: self.plan,
            inherited_plan: self.inherited_plan,
            empty_plan: self.empty_plan,
            overdue: self.overdue,
            ancestors: self
                .ancestors
                .into_iter()
                .map(|ancestor| PlanAncestor {
                    time_scope: ancestor.time_scope,
                })
                .collect(),
        }
    }
}

/// A planning pass: the scope it fills, that scope's parent, and the rows.
#[derive(Deserialize, Tsify)]
pub struct TriageInput {
    /// The scope being filled.
    #[tsify(type = "ScopeKeyWire")]
    target: ScopeKey,
    /// Its parent scope, none for a Season.
    #[tsify(type = "ScopeKeyWire | null")]
    parent: Option<ScopeKey>,
    /// The rows.
    rows: Vec<PlanRowInput>,
}

/// The three heaps of one triage pass, by row id.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct TriageIds {
    /// Unplanned rows relevant to the scope.
    unplanned: Vec<String>,
    /// Rows already planned into the scope.
    planned: Vec<String>,
    /// Rows planned to the scope's parent.
    parent_planned: Vec<String>,
}

/// `triage`: splits the rows into the heaps for the target scope.
#[wasm_bindgen(js_name = planTriage, unchecked_return_type = "TriageIds")]
pub fn plan_triage_js(
    #[wasm_bindgen(unchecked_param_type = "TriageInput")] input: JsValue,
) -> Result<JsValue, JsError> {
    let input: TriageInput = read(input)?;
    let rows: Vec<PlanRow> = input.rows.into_iter().map(PlanRowInput::into_row).collect();
    let panes = triage(&rows, input.target.bounds(), input.parent.as_ref());
    let ids = |heap: Vec<&PlanRow>| heap.into_iter().map(|row| row.id.clone()).collect();
    write(&TriageIds {
        unplanned: ids(panes.unplanned),
        planned: ids(panes.planned),
        parent_planned: ids(panes.parent_planned),
    })
}

/// A move: one row and the scope it would be planned into.
#[derive(Deserialize, Tsify)]
pub struct RefusalInput {
    /// The row.
    row: PlanRowInput,
    /// The scope.
    #[tsify(type = "ScopeKeyWire")]
    target: ScopeKey,
}

/// `PlanRow::refusal`: which bound planning the row into the target would break, if any.
#[wasm_bindgen(
    js_name = planRefusal,
    unchecked_return_type = "\"own_time_scope\" | \"parent_plan\" | null"
)]
pub fn plan_refusal_js(
    #[wasm_bindgen(unchecked_param_type = "RefusalInput")] input: JsValue,
) -> Result<JsValue, JsError> {
    let input: RefusalInput = read(input)?;
    let row = input.row.into_row();
    let refusal: Option<PlanRefusal> = row.refusal(input.target.bounds());
    write(&refusal)
}

/// `take_out`: where work taken out of the scope being filled lands. `"filled"` plans it to the
/// scope itself, `"parent"` to the scope one rung up, `"clear"` clears its Plan.
#[wasm_bindgen(js_name = takeOut, unchecked_return_type = "\"filled\" | \"parent\" | \"clear\"")]
pub fn take_out_js(split: bool, has_parent: bool) -> Result<JsValue, JsError> {
    let landing = match take_out(split, "filled", has_parent.then_some("parent")) {
        TakeOut::Plan(which) => which,
        TakeOut::Clear => "clear",
    };
    write(&landing)
}
