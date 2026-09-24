//! Wire error type: the serialisable shape `AppError` is converted to before
//! crossing the Tauri IPC boundary to the frontend.

use serde::Serialize;

use crate::{
    access::error::AccessError, domains::error::DomainError, error::AppError,
    flows::error::FlowError, knowledge_base::error::KnowledgeBaseError, scopes::error::ScopeError,
    tasks::error::TaskError, undo::error::UndoError,
};

/// Stable, machine-readable classification of a [`WireError`].
///
/// The frontend matches on this to decide how to react (e.g. show a
/// "not found" toast vs. prompt for confirmation) instead of parsing the
/// human-readable `message`. Serialises in snake_case.
///
/// Mirrored in src/api/errors.ts
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WireErrorKind {
    /// The requested resource does not exist.
    NotFound,
    /// The write would violate a scope-containment invariant (e.g. a Plan
    /// wider than its Time Scope).
    ContainmentViolated,
    /// The request is invalid given its inputs or the current state (e.g. a
    /// dependency cycle, a fixed Aspect edit, an unsupported scope kind).
    InvalidRequest,
    /// The operation is valid but ambiguous or destructive enough that the
    /// caller must confirm before it proceeds. Raised by `retype_node` (with
    /// a `details` payload naming what would be lost) and by `update_task`
    /// when backlogging a task that still has a Plan.
    NeedsConfirmation,
    /// The request cannot be carried out until the caller supplies a **Time Scope**.
    ///
    /// Raised only by a write that would produce a Commitment with no effective window — its own
    /// or a scoped ancestor's. Like [`NeedsConfirmation`](Self::NeedsConfirmation) this is not a
    /// failure: the request is well-formed, and the answer is the same request again carrying a
    /// window. Distinct from it because what is missing is information, not consent, and the
    /// frontend answers the two with different prompts.
    NeedsTimeScope,
    /// The MCP endpoint may not touch the node the request names: it is outside every read
    /// grant, or — for a write — outside every write grant.
    ///
    /// Raised only by the MCP tools. A node that does not exist is reported this way too, so the
    /// kind never tells an agent that something exists where it cannot look.
    NotPermitted,
    /// A database-level error occurred.
    Database,
    /// An unexpected or unmapped internal error occurred (e.g. corrupted
    /// persisted data). The matches assigning this kind are deliberately
    /// exhaustive with no wildcard arm: a new domain error variant must be
    /// classified explicitly and will fail to compile until it is, rather
    /// than silently falling back to this kind.
    Internal,
}

/// A serialisable error returned to the frontend across the Tauri IPC
/// boundary.
///
/// Every command should convert its `Result<_, AppError>` into
/// `Result<_, WireError>` via [`WireError::from_error`].
#[derive(Debug, Clone, Serialize)]
pub struct WireError {
    /// Stable, machine-readable classification of the error.
    kind: WireErrorKind,
    /// Human-readable description, suitable for logs or a generic toast.
    message: String,
    /// Optional structured payload carrying extra context for the frontend.
    /// Unused until Phase 4 (e.g. confirmation prompts); omitted from the
    /// serialised form when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<serde_json::Value>,
}

impl WireError {
    /// Converts any error convertible to [`AppError`] into a [`WireError`],
    /// assigning it a stable `kind` and capturing its message.
    ///
    /// This is the conversion command sites use: `.map_err(WireError::from_error)`
    /// works regardless of which domain error the `Result` holds, because
    /// `AppError` already implements `From` for each domain error. A blanket
    /// `impl<E: Into<AppError>> From<E> for WireError` would conflict with
    /// the coherence rules, so this associated function is the entry point
    /// instead.
    pub fn from_error(error: impl Into<AppError>) -> Self {
        let error = error.into();
        let kind = kind_of(&error);
        let message = error.to_string();
        Self {
            kind,
            message,
            details: None,
        }
    }

    /// Builds an [`InvalidRequest`](WireErrorKind::InvalidRequest) [`WireError`] directly,
    /// bypassing [`AppError`].
    ///
    /// For errors that arise at the command boundary and have no domain-error home to route
    /// through `AppError` — e.g. parsing a caller-supplied string (a date, a datetime) before it
    /// ever reaches a repository. Forcing such a parsing failure into `AppError` would drag a
    /// request-validation concern into the domain error surface, so this constructor is the
    /// escape hatch for that boundary instead.
    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self {
            kind: WireErrorKind::InvalidRequest,
            message: message.into(),
            details: None,
        }
    }

    /// Builds an [`Internal`](WireErrorKind::Internal) [`WireError`] directly, bypassing
    /// [`AppError`].
    ///
    /// For a failure at the command boundary that is nobody's request and no domain's business —
    /// the windowing system refusing to open a window, say. It is deliberately separate from
    /// [`WireError::invalid_request`]: telling the user their request was invalid when the request
    /// was fine and the platform was not sends them looking in the wrong place.
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: WireErrorKind::Internal,
            message: message.into(),
            details: None,
        }
    }

    /// Builds a [`NotPermitted`](WireErrorKind::NotPermitted) [`WireError`] directly, bypassing
    /// [`AppError`].
    ///
    /// Access is an MCP-layer rule rather than a domain one — the app's own commands are never
    /// refused for it — so there is no domain error for it to route through.
    pub fn not_permitted(message: impl Into<String>) -> Self {
        Self {
            kind: WireErrorKind::NotPermitted,
            message: message.into(),
            details: None,
        }
    }

    /// Builds a [`NeedsConfirmation`](WireErrorKind::NeedsConfirmation) [`WireError`] carrying the
    /// structured `details` the frontend needs to say what is at stake.
    ///
    /// The one error kind that is not a failure: the request was well-formed and the backend is
    /// able to carry it out, but doing so would destroy something, so it refuses until the caller
    /// says it knows. `details` is what makes that answerable — a refusal the user can only
    /// accept blind is not consent. `retype_node` is the first caller; its payload is
    /// [`crate::tasks::retype::TransferPlan::details`].
    pub fn needs_confirmation(message: impl Into<String>, details: serde_json::Value) -> Self {
        Self {
            kind: WireErrorKind::NeedsConfirmation,
            message: message.into(),
            details: Some(details),
        }
    }
}

impl From<AppError> for WireError {
    fn from(error: AppError) -> Self {
        Self::from_error(error)
    }
}

/// Assigns a [`WireErrorKind`] to an [`AppError`], walking into nested
/// domain errors (e.g. `TaskError::Scope`, `FlowError::Task`) so they carry
/// the same kind the wrapped error would on its own.
fn kind_of(error: &AppError) -> WireErrorKind {
    match error {
        AppError::Domain(inner) => domain_kind(inner),
        AppError::Task(inner) => task_kind(inner),
        AppError::Scope(inner) => scope_kind(inner),
        AppError::KnowledgeBase(inner) => knowledge_base_kind(inner),
        AppError::Flow(inner) => flow_kind(inner),
        AppError::Undo(inner) => undo_kind(inner),
        AppError::Access(inner) => access_kind(inner),
        AppError::Database(sqlx::Error::RowNotFound) => WireErrorKind::NotFound,
        AppError::Database(_) => WireErrorKind::Database,
    }
}

/// Maps an [`UndoError`] variant to its [`WireErrorKind`].
/// Classifies an [`AccessError`]: a grant on a node that is not there is `not_found`, exactly as
/// an edit to one would be.
fn access_kind(error: &AccessError) -> WireErrorKind {
    match error {
        AccessError::NodeNotFound(_) => WireErrorKind::NotFound,
        AccessError::Corrupt(_) => WireErrorKind::Internal,
        AccessError::Database(_) => WireErrorKind::Database,
    }
}

fn undo_kind(error: &UndoError) -> WireErrorKind {
    match error {
        // The request itself is malformed: a close with no matching open. The caller's gesture
        // pairing is wrong, and it is the caller that can fix it.
        UndoError::NoGestureOpen => WireErrorKind::InvalidRequest,
        // A `source` no `WriteSource` names can only have been written from outside this crate,
        // so it is persisted data the app cannot interpret rather than anything the caller sent.
        // Likewise persisted data the app cannot interpret: the journal's own CHECK constraint
        // admits exactly three operations, and the triggers write every image with `json_object`
        // over the table's columns, so none of these three can come from a caller.
        UndoError::UnknownWriteSource(_)
        | UndoError::UnknownRowOperation(_)
        | UndoError::MalformedImage(_)
        | UndoError::MalformedEntry { .. }
        | UndoError::UnsafeIdentifier(_) => WireErrorKind::Internal,
        // A Gesture that would not go back on is almost always a constraint the board has since
        // acquired — a row the undo would reinstate whose parent is gone — which is a database
        // failure the caller can neither rephrase nor be blamed for.
        // Same again for a Gesture that would not come back off: an abort replays it through the
        // same engine, and what stops that is the state of the board rather than the request.
        UndoError::ApplyFailed { .. } | UndoError::AbortFailed { .. } => WireErrorKind::Database,
        UndoError::Database(_) => WireErrorKind::Database,
    }
}

/// Maps a [`DomainError`] variant to its [`WireErrorKind`].
fn domain_kind(error: &DomainError) -> WireErrorKind {
    match error {
        DomainError::NotFound(_) => WireErrorKind::NotFound,
        DomainError::FixedAspect
        | DomainError::TagCannotHaveChildren
        | DomainError::InvalidParent(_) => WireErrorKind::InvalidRequest,
        DomainError::Database(_) => WireErrorKind::Database,
    }
}

/// Maps a [`TaskError`] variant to its [`WireErrorKind`], walking into a
/// nested [`ScopeError`] rather than giving it its own kind.
fn task_kind(error: &TaskError) -> WireErrorKind {
    match error {
        TaskError::TaskNotFound(_)
        | TaskError::GoalNotFound(_)
        | TaskError::CommitmentNotFound(_)
        | TaskError::ExpectationNotFound(_)
        | TaskError::NoSpawnedWait(_) => WireErrorKind::NotFound,
        // The request named a check that is no longer there to complete.
        TaskError::NoCheckDue | TaskError::CheckNotReopenable => WireErrorKind::InvalidRequest,
        TaskError::CircularDependency => WireErrorKind::InvalidRequest,
        // Not `InvalidRequest`: the request is well-formed and could be carried out. The backend
        // is asking whether to throw the Plan away, and the caller answers by asking again with
        // the Plan cleared.
        TaskError::BacklogWithPlan => WireErrorKind::NeedsConfirmation,
        // Not `InvalidRequest`: the request was fine and the stored tree is not. Nothing the
        // caller can rephrase will fix it, which is what `Internal` means here.
        TaskError::AncestorCycle { .. } => WireErrorKind::Internal,
        TaskError::ScopeContainment(_) => WireErrorKind::ContainmentViolated,
        // Not a containment violation: nothing escapes anything, and not an invalid request
        // either — the caller asked for something reachable, it just has to say over what window.
        // The frontend turns this into the prompt that asks, so it needs its own kind rather than
        // a message to match on.
        TaskError::CommitmentUnscoped => WireErrorKind::NeedsTimeScope,
        TaskError::Scope(inner) => scope_kind(inner),
        TaskError::Database(_) => WireErrorKind::Database,
    }
}

/// Maps a [`ScopeError`] variant to its [`WireErrorKind`].
fn scope_kind(error: &ScopeError) -> WireErrorKind {
    match error {
        // A key is parsed from what the caller sent; one read back from the database that does not
        // parse fails inside sqlx's decode instead, as a `Database` error of whoever read it.
        ScopeError::MalformedKey(_, _)
        | ScopeError::EmptyExact(_, _)
        | ScopeError::UnsupportedKind(_) => WireErrorKind::InvalidRequest,
    }
}

/// Maps a [`KnowledgeBaseError`] variant to its [`WireErrorKind`].
fn knowledge_base_kind(error: &KnowledgeBaseError) -> WireErrorKind {
    match error {
        KnowledgeBaseError::PersonNotFound(_)
        | KnowledgeBaseError::EventNotFound(_)
        | KnowledgeBaseError::ThreadNotFound(_) => WireErrorKind::NotFound,
        KnowledgeBaseError::Database(_) => WireErrorKind::Database,
    }
}

/// Maps a [`FlowError`] variant to its [`WireErrorKind`], walking into
/// nested [`ScopeError`] and [`TaskError`] rather than giving them their own
/// kind.
fn flow_kind(error: &FlowError) -> WireErrorKind {
    match error {
        FlowError::NotFound(_) => WireErrorKind::NotFound,
        FlowError::Database(_) => WireErrorKind::Database,
        FlowError::Scope(inner) => scope_kind(inner),
        FlowError::Task(inner) => task_kind(inner),
        FlowError::Invalid(_) => WireErrorKind::InvalidRequest,
    }
}

#[cfg(test)]
mod tests;
