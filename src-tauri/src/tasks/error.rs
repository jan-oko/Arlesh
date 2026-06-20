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
    /// A database error occurred.
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}
