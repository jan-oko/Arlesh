//! Scope operation errors.

/// Errors that can occur during scope operations.
#[derive(Debug, thiserror::Error)]
pub enum ScopeError {
    /// The requested scope does not exist.
    #[error("scope {0} not found")]
    NotFound(i64),
    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
