//! Top-level application error type, and its wire representation.

mod wire;

pub use wire::{WireError, WireErrorKind};

use crate::{
    access::error::AccessError, domains::error::DomainError, flows::error::FlowError,
    knowledge_base::error::KnowledgeBaseError, scopes::error::ScopeError, tasks::error::TaskError,
    undo::error::UndoError,
};

/// Application-level error wrapping all domain errors.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Domain (Aspects/Projects/Domains/Tags) operation error.
    #[error(transparent)]
    Domain(#[from] DomainError),
    /// Task/Goal operation error.
    #[error(transparent)]
    Task(#[from] TaskError),
    /// Scope operation error.
    #[error(transparent)]
    Scope(#[from] ScopeError),
    /// Knowledge-base entity operation error.
    #[error(transparent)]
    KnowledgeBase(#[from] KnowledgeBaseError),
    /// Flow operation error.
    #[error(transparent)]
    Flow(#[from] FlowError),
    /// MCP access grant error.
    #[error(transparent)]
    Access(#[from] AccessError),
    /// Undo Journal context error.
    #[error(transparent)]
    Undo(#[from] UndoError),
    /// A database error occurred with no domain-specific error to wrap it (e.g. the `infos`
    /// and `block_reasons` repositories, which have no domain error enum of their own).
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
