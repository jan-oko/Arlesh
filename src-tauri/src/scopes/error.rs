//! Scope operation errors.

/// Errors that can occur during scope operations.
#[derive(Debug, thiserror::Error)]
pub enum ScopeError {
    /// JSON that is not the value key of any scope (see [`super::key`]).
    #[error("malformed scope key {0:?}: {1}")]
    MalformedKey(String, String),
    /// An Exact window that does not end after it starts.
    #[error("an exact scope must end after it starts: {0} – {1}")]
    EmptyExact(String, String),
    /// An operation received a scope kind it does not support (e.g. a Part-of-Day or Exact kind
    /// where only a canonical kind, named by a date alone, makes sense).
    #[error("unsupported scope kind for this operation: {0}")]
    UnsupportedKind(&'static str),
}
