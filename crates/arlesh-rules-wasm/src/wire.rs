//! The shared edge: reading an argument and writing a result.

use serde::{de::DeserializeOwned, Serialize};
use wasm_bindgen::prelude::*;

/// TypeScript spellings of the domain values that cross the boundary. They match the serde shapes
/// of `ScopeKey`, `TimeScope`, `Status` and `NodeKind` in `arlesh-rules`; the corpora under
/// `conformance/` pin that they do.
#[wasm_bindgen(typescript_custom_section)]
const DOMAIN_TYPES: &'static str = r#"
export type PartOfDayWire = "premorning" | "morning" | "noon" | "afternoon" | "evening" | "night";
export type ScopeKeyWire =
  | { kind: "season" | "month" | "week" | "day"; date: string }
  | { kind: "part_of_day"; date: string; part: PartOfDayWire }
  | { kind: "exact"; start: string; end: string };
export type TimeScopeWire = { start_id: ScopeKeyWire; end_id: ScopeKeyWire; duration?: { n: number; kind: string } };
export type TaskStatusWire =
  | { kind: "ordinary"; status: "todo" | "in_progress" | "started" | "done" }
  | { kind: "agentic"; status: "todo" | "on_agent" | "review" | "doing" | "done" };
export type VerdictWire = "unresolved" | "kept" | "broken";
export type NodeKindWire =
  | "aspect" | "project" | "domain" | "tag" | "goal" | "task" | "commitment" | "expectation"
  | "info" | "flow" | "flow_goal" | "flow_task" | "flow_commitment" | "flow_expectation"
  | "habit_group";
"#;

/// Reads a JS value as `T`.
pub(crate) fn read<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    Ok(serde_wasm_bindgen::from_value(value)?)
}

/// Writes `T` as a JS value: plain objects (not `Map`s) and `null` for `None`.
pub(crate) fn write<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    Ok(value.serialize(&serde_wasm_bindgen::Serializer::json_compatible())?)
}
