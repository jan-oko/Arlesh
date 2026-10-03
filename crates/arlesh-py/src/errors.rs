//! How a failure crosses into Python: one exception type carrying the failure as JSON.

use arlesh_core::error::{WireError, WireErrorKind};
use pyo3::{create_exception, exceptions::PyException, PyErr};
use serde::Serialize;

create_exception!(
    _native,
    NativeError,
    PyException,
    "A failure from the core, its one argument a JSON object: `kind`, `message`, `details`."
);

/// A failure that is not a domain error but still has a `WireError` kind — opening a database,
/// reading a request, or a request a read-only database cannot serve. Serialises exactly as a
/// [`WireError`] does, so the Python half reads both the same way.
#[derive(Debug, Serialize)]
pub(crate) struct Failure {
    /// The stable classification the caller branches on.
    kind: WireErrorKind,
    /// What went wrong, for a person.
    message: String,
    /// Structured context, when there is any.
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<serde_json::Value>,
}

impl Failure {
    /// A failure of `kind`, with `message` and no details.
    pub(crate) fn new(kind: WireErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
        }
    }

    /// The same failure, carrying `details`.
    pub(crate) fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
}

/// Anything that crosses as a [`NativeError`].
pub(crate) enum Raised {
    /// A domain error, already in its wire form.
    Wire(WireError),
    /// A failure the bindings classified themselves.
    Failure(Failure),
}

impl From<WireError> for Raised {
    fn from(error: WireError) -> Self {
        Self::Wire(error)
    }
}

impl From<Failure> for Raised {
    fn from(failure: Failure) -> Self {
        Self::Failure(failure)
    }
}

/// The Python exception for `raised`.
pub(crate) fn raise(raised: impl Into<Raised>) -> PyErr {
    let json = match raised.into() {
        Raised::Wire(error) => serde_json::to_string(&error),
        Raised::Failure(failure) => serde_json::to_string(&failure),
    };
    // Serialising a string, an enum and a JSON value cannot fail; if it somehow did, the message
    // still has to reach the caller, so it goes as the kind `internal`.
    let json = json.unwrap_or_else(|error| {
        format!(r#"{{"kind":"internal","message":"unserialisable error: {error}"}}"#)
    });
    NativeError::new_err(json)
}
