//! Task and Goal operation errors.

/// Errors that can occur during task or goal operations.
#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    /// The requested task does not exist.
    #[error("task {0} not found")]
    TaskNotFound(i64),
    /// The requested goal does not exist.
    #[error("goal {0} not found")]
    GoalNotFound(i64),
    /// Adding this dependency would create a circular dependency chain.
    #[error("adding this dependency would create a cycle")]
    CircularDependency,
    /// A write would break a scope-containment invariant (e.g. a Plan wider than its Time Scope).
    #[error("scope containment violation: {0}")]
    ScopeContainment(String),
    /// A referenced scope could not be resolved.
    #[error("scope error: {0}")]
    Scope(#[from] crate::scopes::error::ScopeError),
    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
