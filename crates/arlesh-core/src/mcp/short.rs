//! The short answer a write gives by default.
//!
//! A Task's whole `agentic_brief` can run to thousands of tokens, and a write used to send it back
//! every time. A write now answers with what the agent needs to carry on — the ids, the title and
//! the status — and `verbose: true` asks for the whole row as before.

use serde_json::{Map, Value};

/// Whether a write that does not say `verbose` answers briefly. Flip this one constant to make the
/// whole row the default again.
const BRIEF_BY_DEFAULT: bool = true;

/// Whether this write's answer is the whole row, given the `verbose` it was sent with.
pub(super) fn is_verbose(asked: Option<bool>) -> bool {
    asked.unwrap_or(!BRIEF_BY_DEFAULT)
}

/// The fields of a written Task a short answer keeps.
const TASK_FIELDS: [&str; 5] = ["id", "short_id", "full_id", "title", "status"];

/// The fields of a written wait a short answer keeps.
const WAIT_FIELDS: [&str; 9] = [
    "id",
    "short_id",
    "full_id",
    "title",
    "status",
    "question",
    "task_id",
    "task_short_id",
    "review",
];

/// `row` cut to the `kept` fields that it has.
fn keeping(row: &Value, kept: &[&str]) -> Map<String, Value> {
    kept.iter()
        .filter_map(|field| Some(((*field).to_string(), row.get(*field)?.clone())))
        .collect()
}

/// A written Task as the short answer tells it; `changed` names the fields an update set.
pub(super) fn task(row: &Value, changed: Option<&[&str]>) -> Value {
    let mut short = keeping(row, &TASK_FIELDS);
    if let Some(changed) = changed {
        short.insert("changed".into(), changed.into());
    }
    Value::Object(short)
}

/// A written wait as the short answer tells it: no note, no answer. A review keeps only its
/// verdict.
pub(super) fn wait(row: &Value) -> Value {
    let mut short = keeping(row, &WAIT_FIELDS);
    if let Some(review) = short.remove("review") {
        short.insert("review".into(), Value::Bool(true));
        if let Some(verdict) = review.get("verdict").filter(|verdict| !verdict.is_null()) {
            short.insert("verdict".into(), verdict.clone());
        }
    }
    Value::Object(short)
}
