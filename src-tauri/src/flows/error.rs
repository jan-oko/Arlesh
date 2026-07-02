//! Flow operation errors.

/// Errors that can occur during flow operations.
#[derive(Debug, thiserror::Error)]
pub enum FlowError {
    /// The requested flow does not exist.
    #[error("flow {0} not found")]
    NotFound(i64),
    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
