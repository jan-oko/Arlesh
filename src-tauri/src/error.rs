//! Top-level application error type.

use crate::{domains::error::DomainError, kb::error::KbError, scopes::error::ScopeError, tasks::error::TaskError};

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
    Kb(#[from] KbError),
}
