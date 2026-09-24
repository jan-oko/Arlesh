//! MCP access operation errors.

use super::model::NodeKey;

/// Errors that can occur while reading or changing the MCP roots.
#[derive(Debug, thiserror::Error)]
pub enum AccessError {
    /// An MCP root named a node that is not a row of its table.
    #[error("{0} not found")]
    NodeNotFound(NodeKey),
    /// A stored row holds a value its CHECK constraint should have refused.
    #[error("unreadable stored access data: {0}")]
    Corrupt(String),
    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
