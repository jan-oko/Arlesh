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
    /// A scope could not be resolved or created during materialisation.
    #[error("scope error: {0}")]
    Scope(#[from] crate::scopes::error::ScopeError),
    /// A materialised task/goal could not be created (e.g. scope containment).
    #[error("task error: {0}")]
    Task(#[from] crate::tasks::error::TaskError),
    /// The start request was invalid (e.g. flow has no scope but an anchor was given).
    #[error("invalid flow start: {0}")]
    Invalid(String),
}
