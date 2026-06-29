//! Scope operation errors.

/// Errors that can occur during scope operations.
#[derive(Debug, thiserror::Error)]
pub enum ScopeError {
    /// The requested scope does not exist.
    #[error("scope {0} not found")]
    NotFound(i64),
    /// A scope row held data that could not be parsed (e.g. a malformed datetime).
    #[error("malformed scope {0}: {1}")]
    Malformed(i64, String),
    /// An operation received a scope kind it does not support (e.g. canonical get-or-create
    /// called with a Part-of-Day or Exact kind, which have dedicated constructors).
    #[error("unsupported scope kind for this operation: {0}")]
    UnsupportedKind(&'static str),
    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
