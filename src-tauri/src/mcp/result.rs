//! Turning a domain outcome into an MCP tool result.
//!
//! Success and domain failure are both *results*, not transport errors: a task that does not exist
//! is an answer the agent should reason about, so it comes back as `is_error: true` carrying a
//! [`WireError`] rather than as a JSON-RPC error. The `Err` arm of the tool signature is reserved
//! for the cases where no answer can be produced at all.

use rmcp::model::{CallToolResult, ErrorData};
use serde::Serialize;

use crate::error::{AppError, WireError};

/// Serialises `value`, reporting a serialisation failure as an internal transport error.
fn structured(value: impl Serialize) -> Result<serde_json::Value, ErrorData> {
    serde_json::to_value(value).map_err(|error| {
        ErrorData::internal_error(format!("failed to serialise tool result: {error}"), None)
    })
}

/// Converts a domain outcome into a tool result.
///
/// The error arm keeps the `kind` discriminant `WireError` assigns — `not_found`,
/// `containment_violated`, `invalid_request`, `not_permitted`, `database`, `internal` — so an agent can branch on
/// the same stable value the frontend does instead of parsing the message.
pub(super) fn respond<T: Serialize>(
    outcome: Result<T, impl Into<AppError>>,
) -> Result<CallToolResult, ErrorData> {
    match outcome {
        Ok(value) => Ok(CallToolResult::structured(structured(value)?)),
        Err(error) => Ok(CallToolResult::structured_error(structured(
            WireError::from_error(error),
        )?)),
    }
}

/// A tool result for a value that cannot have failed — a payload already in hand.
///
/// [`respond`] needs an error type to name even when the `Err` arm is unreachable, and a phantom
/// `Ok::<_, SomeUnrelatedError>(value)` at the call site reads as though that error were possible.
pub(super) fn ok(value: impl Serialize) -> Result<CallToolResult, ErrorData> {
    Ok(CallToolResult::structured(structured(value)?))
}

/// A tool result for a request the server understood but will not carry out.
///
/// Distinct from [`respond`]'s error arm, which reports a domain error. This is for a rule the MCP
/// layer enforces itself and no domain error names — reaching for the nearest existing variant
/// would put a misleading `kind` and a misleading message in front of the agent.
pub(super) fn refused(message: impl Into<String>) -> Result<CallToolResult, ErrorData> {
    Ok(CallToolResult::structured_error(structured(
        WireError::invalid_request(message),
    )?))
}

/// A tool result for a failure that happened before any operation could run — opening the session.
pub(super) fn failed(error: impl Into<AppError>) -> Result<CallToolResult, ErrorData> {
    Ok(CallToolResult::structured_error(structured(
        WireError::from_error(error),
    )?))
}

/// A tool result refusing a short id that matched several visible nodes, listing them.
pub(super) fn ambiguous(
    quoted: &str,
    candidates: &[super::ids::Named],
) -> Result<CallToolResult, ErrorData> {
    Ok(CallToolResult::structured_error(structured(
        WireError::ambiguous_id(
            format!(
                "{quoted} matches {} nodes; name one by a longer short id",
                candidates.len()
            ),
            structured(candidates)?,
        ),
    )?))
}

/// A tool result refusing a compare-and-set status write whose expectation no longer holds.
pub(super) fn status_changed(current: &str) -> Result<CallToolResult, ErrorData> {
    Ok(CallToolResult::structured_error(structured(
        WireError::status_changed(current),
    )?))
}

/// A tool result refusing a request that names a node the MCP may not touch.
///
/// Its own `kind`, `not_permitted`, rather than `not_found` or `invalid_request`: the request was
/// well-formed and the node may well exist, and an agent needs to tell "ask the user for access"
/// apart from both.
pub(super) fn not_permitted(message: impl Into<String>) -> Result<CallToolResult, ErrorData> {
    Ok(CallToolResult::structured_error(structured(
        WireError::not_permitted(message),
    )?))
}

/// Unwraps a domain outcome inside a tool, or returns from the tool with it as a failed result —
/// the `?` a tool cannot use, since its error arm is reserved for transport failures.
macro_rules! attempt {
    ($outcome:expr) => {
        match $outcome {
            Ok(value) => value,
            Err(error) => return $crate::mcp::result::failed(error),
        }
    };
}
pub(super) use attempt;
