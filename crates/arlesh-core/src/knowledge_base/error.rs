//! Knowledge-base entity operation errors.

use crate::nodes::id::RowId;

/// Errors that can occur during knowledge-base entity operations.
#[derive(Debug, thiserror::Error)]
pub enum KnowledgeBaseError {
    /// The requested person does not exist.
    #[error("person {0} not found")]
    PersonNotFound(RowId),
    /// The requested event does not exist.
    #[error("event {0} not found")]
    EventNotFound(RowId),
    /// The requested thread does not exist.
    #[error("thread {0} not found")]
    ThreadNotFound(RowId),
    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
