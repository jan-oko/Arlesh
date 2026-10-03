//! Domain operation errors.

/// Errors that can occur during domain (Aspect/Project/Domain/Tag) operations.
#[derive(Debug, thiserror::Error)]
pub enum DomainError {
    /// The requested domain does not exist.
    #[error("domain {0} not found")]
    NotFound(i64),
    /// Attempted to create, update, or delete a fixed Aspect.
    #[error("aspects are fixed and cannot be modified")]
    FixedAspect,
    /// A Tag cannot have children.
    #[error("tags cannot have child domains")]
    TagCannotHaveChildren,
    /// The specified parent is incompatible with the subtype being created.
    #[error("invalid parent for this domain subtype: {0}")]
    InvalidParent(String),
    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
