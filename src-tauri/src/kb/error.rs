//! Knowledge-base entity operation errors.

/// Errors that can occur during knowledge-base entity operations.
#[derive(Debug, thiserror::Error)]
pub enum KbError {
    /// The requested person does not exist.
    #[error("person {0} not found")]
    PersonNotFound(i64),
    /// The requested event does not exist.
    #[error("event {0} not found")]
    EventNotFound(i64),
    /// The requested thread does not exist.
    #[error("thread {0} not found")]
    ThreadNotFound(i64),
    /// A database error occurred.
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}
