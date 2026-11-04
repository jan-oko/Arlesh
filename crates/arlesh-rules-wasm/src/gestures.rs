//! `tasks::rules::gestures`: what a press on a Task or a Commitment writes.

use arlesh_rules::tasks::model::{Status, Verdict};
use arlesh_rules::tasks::rules::gestures::{
    alt_step, next_status, status_after, verdict_after, StatusRefusal, StatusStep, VerdictPress,
};
use serde::Serialize;
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use crate::wire::{read, write};

/// What a status gesture leaves: the status it writes, or why it writes nothing.
#[derive(Serialize, Tsify)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum StatusPrediction {
    /// The status it writes.
    Written {
        /// The status.
        #[tsify(type = "TaskStatusWire")]
        status: Status,
    },
    /// Why it writes nothing.
    Refused {
        /// The reason.
        #[tsify(type = "\"compound\" | \"alt_enter_agentic_not_doing\"")]
        reason: StatusRefusal,
    },
}

fn predict(result: Result<Status, StatusRefusal>) -> StatusPrediction {
    match result {
        Ok(status) => StatusPrediction::Written { status },
        Err(reason) => StatusPrediction::Refused { reason },
    }
}

/// `status_after`: what `step` writes on a Task reading `current`.
#[wasm_bindgen(js_name = statusAfter, unchecked_return_type = "StatusPrediction")]
pub fn status_after_js(
    #[wasm_bindgen(unchecked_param_type = "\"advance\" | \"alt\"")] step: JsValue,
    #[wasm_bindgen(unchecked_param_type = "TaskStatusWire")] current: JsValue,
    compound: bool,
) -> Result<JsValue, JsError> {
    let step: StatusStep = read(step)?;
    let current: Status = read(current)?;
    write(&predict(status_after(step, current, compound)))
}

/// `next_status`: one step of the click/`Enter` cycle.
#[wasm_bindgen(js_name = nextStatus, unchecked_return_type = "TaskStatusWire")]
pub fn next_status_js(
    #[wasm_bindgen(unchecked_param_type = "TaskStatusWire")] current: JsValue,
) -> Result<JsValue, JsError> {
    let current: Status = read(current)?;
    write(&next_status(current))
}

/// `alt_step`: the step `Alt+Enter` takes.
#[wasm_bindgen(js_name = altStep, unchecked_return_type = "StatusPrediction")]
pub fn alt_step_js(
    #[wasm_bindgen(unchecked_param_type = "TaskStatusWire")] current: JsValue,
) -> Result<JsValue, JsError> {
    let current: Status = read(current)?;
    write(&predict(alt_step(current)))
}

/// `verdict_after`: the verdict `press` leaves a Commitment reading `current`.
#[wasm_bindgen(js_name = verdictAfter, unchecked_return_type = "VerdictWire")]
pub fn verdict_after_js(
    #[wasm_bindgen(unchecked_param_type = "\"cycle\" | \"kept\" | \"broken\"")] press: JsValue,
    #[wasm_bindgen(unchecked_param_type = "VerdictWire")] current: JsValue,
) -> Result<JsValue, JsError> {
    let press: VerdictPress = read(press)?;
    let current: Verdict = read(current)?;
    write(&verdict_after(press, current))
}
