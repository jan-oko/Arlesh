//! The MCP's answers as JSON, for a host that speaks the protocol itself.
//!
//! The Python server carries JSON-RPC and nothing else, so each answer here is the `result` or the
//! `error` of the request, ready to be put in its envelope: `{"result": ...}` or `{"error":
//! {"code", "message", "data"}}`. They are the words the connected endpoint says — the same
//! negotiation, instructions, tool list, results and refusals — because they come from the same
//! handler.

use rmcp::{
    model::{InitializeRequestParams, JsonObject},
    ErrorData,
};
use serde::Serialize;
use serde_json::{json, Value};

use super::ArleshMcp;

/// The first protocol version whose results carry `resultType`.
pub const RESULT_TYPE_FROM: &str = "2026-07-28";

/// Whether a client on `version` is sent `resultType` (ISO dates compare as text, as `rmcp` does).
fn has_result_type(version: &str) -> bool {
    version >= RESULT_TYPE_FROM
}

/// `outcome` as the answer to a request: its `result`, or its `error`.
fn answer(outcome: Result<impl Serialize, ErrorData>) -> Value {
    let serialised = outcome.and_then(|result| {
        serde_json::to_value(result).map_err(|error| {
            ErrorData::internal_error(format!("failed to serialise the answer: {error}"), None)
        })
    });
    match serialised {
        Ok(result) => json!({ "result": result }),
        Err(error) => json!({ "error": error }),
    }
}

impl ArleshMcp {
    /// The answer to `initialize` with these `params`: the handshake as a connected client gets
    /// it. Params that are not an `initialize` request are refused as invalid params.
    pub async fn answer_initialize(&self, params: Value) -> Value {
        let request = serde_json::from_value::<InitializeRequestParams>(params).map_err(|error| {
            ErrorData::invalid_params(format!("invalid initialize params: {error}"), None)
        });
        match request {
            Ok(request) => answer(self.initialize_result(&request).await),
            Err(error) => answer(Err::<Value, _>(error)),
        }
    }

    /// The answer to `tools/call` for the tool `name` and its `arguments` (an object, or none).
    /// Arguments of any other shape are refused as invalid params.
    ///
    /// `protocol_version` is the one the client sends with the request (its
    /// `MCP-Protocol-Version`), since there is no session to remember it: a client older than
    /// [`RESULT_TYPE_FROM`], or one that names none, is answered in the shape it has always had,
    /// without the `resultType` member the connected endpoint also leaves out for it.
    pub async fn answer_call(
        &self,
        name: &str,
        arguments: Value,
        protocol_version: Option<&str>,
    ) -> Value {
        let arguments = match arguments {
            Value::Null => None,
            Value::Object(object) => Some(JsonObject::from_iter(object)),
            other => {
                let message = format!("tool arguments must be an object, not {other}");
                return answer(Err::<Value, _>(ErrorData::invalid_params(message, None)));
            }
        };
        let outcome = self.call(name, arguments).await.map(|response| {
            let mut result = rmcp::model::ServerResult::from(response);
            if !protocol_version.is_some_and(has_result_type) {
                result.strip_result_type_for_legacy_peer();
            }
            result
        });
        answer(outcome)
    }
}

#[cfg(test)]
mod tests;
