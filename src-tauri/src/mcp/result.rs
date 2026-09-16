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
/// `containment_violated`, `invalid_request`, `database`, `internal` — so an agent can branch on
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

/// A tool result for a failure that happened before any operation could run — opening the session.
pub(super) fn failed(error: impl Into<AppError>) -> Result<CallToolResult, ErrorData> {
    Ok(CallToolResult::structured_error(structured(
        WireError::from_error(error),
    )?))
}
