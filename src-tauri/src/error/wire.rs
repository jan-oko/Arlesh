//! Wire error type: the serialisable shape `AppError` is converted to before
//! crossing the Tauri IPC boundary to the frontend.

use serde::Serialize;

use crate::{
    domains::error::DomainError, error::AppError, flows::error::FlowError,
    knowledge_base::error::KnowledgeBaseError, scopes::error::ScopeError, tasks::error::TaskError,
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
        AppError::Database(sqlx::Error::RowNotFound) => WireErrorKind::NotFound,
        AppError::Database(_) => WireErrorKind::Database,
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
        | TaskError::CommitmentNotFound(_) => WireErrorKind::NotFound,
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
        ScopeError::NotFound(_) => WireErrorKind::NotFound,
        // Malformed persisted data is not the caller's fault and is not a
        // not-found/invalid-request case — it is an internal invariant
        // violation discovered while reading.
        ScopeError::Malformed(_, _) => WireErrorKind::Internal,
        ScopeError::UnsupportedKind(_) => WireErrorKind::InvalidRequest,
        ScopeError::Database(_) => WireErrorKind::Database,
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
mod tests {
    use super::{WireError, WireErrorKind};
    use crate::{
        domains::error::DomainError, error::AppError, flows::error::FlowError,
        knowledge_base::error::KnowledgeBaseError, scopes::error::ScopeError,
        tasks::error::TaskError,
    };

    fn kind_of(error: impl Into<AppError>) -> WireErrorKind {
        WireError::from_error(error).kind
    }

    // --- DomainError ---

    #[test]
    fn domain_not_found_maps_to_not_found() {
        assert_eq!(kind_of(DomainError::NotFound(1)), WireErrorKind::NotFound);
    }

    #[test]
    fn domain_fixed_aspect_maps_to_invalid_request() {
        assert_eq!(
            kind_of(DomainError::FixedAspect),
            WireErrorKind::InvalidRequest
        );
    }

    #[test]
    fn domain_tag_cannot_have_children_maps_to_invalid_request() {
        assert_eq!(
            kind_of(DomainError::TagCannotHaveChildren),
            WireErrorKind::InvalidRequest
        );
    }

    #[test]
    fn domain_invalid_parent_maps_to_invalid_request() {
        assert_eq!(
            kind_of(DomainError::InvalidParent("goal".to_string())),
            WireErrorKind::InvalidRequest
        );
    }

    #[test]
    fn domain_database_maps_to_database() {
        assert_eq!(
            kind_of(DomainError::Database(sqlx::Error::RowNotFound)),
            WireErrorKind::Database
        );
    }

    // --- TaskError ---

    #[test]
    fn task_task_not_found_maps_to_not_found() {
        assert_eq!(kind_of(TaskError::TaskNotFound(1)), WireErrorKind::NotFound);
    }

    #[test]
    fn task_goal_not_found_maps_to_not_found() {
        assert_eq!(kind_of(TaskError::GoalNotFound(1)), WireErrorKind::NotFound);
    }

    #[test]
    fn task_circular_dependency_maps_to_invalid_request() {
        assert_eq!(
            kind_of(TaskError::CircularDependency),
            WireErrorKind::InvalidRequest
        );
    }

    #[test]
    fn task_backlog_with_plan_maps_to_needs_confirmation() {
        assert_eq!(
            kind_of(TaskError::BacklogWithPlan),
            WireErrorKind::NeedsConfirmation
        );
    }

    #[test]
    fn task_commitment_unscoped_asks_for_a_window_rather_than_refusing_the_request() {
        assert_eq!(
            kind_of(TaskError::CommitmentUnscoped),
            WireErrorKind::NeedsTimeScope
        );
    }

    #[test]
    fn task_scope_containment_maps_to_containment_violated() {
        assert_eq!(
            kind_of(TaskError::ScopeContainment(
                "plan wider than time scope".to_string()
            )),
            WireErrorKind::ContainmentViolated
        );
    }

    #[test]
    fn task_nested_scope_error_maps_by_walking_into_it() {
        assert_eq!(
            kind_of(TaskError::Scope(ScopeError::NotFound(1))),
            WireErrorKind::NotFound
        );
    }

    #[test]
    fn task_database_maps_to_database() {
        assert_eq!(
            kind_of(TaskError::Database(sqlx::Error::RowNotFound)),
            WireErrorKind::Database
        );
    }

    // --- ScopeError ---

    #[test]
    fn scope_not_found_maps_to_not_found() {
        assert_eq!(kind_of(ScopeError::NotFound(1)), WireErrorKind::NotFound);
    }

    #[test]
    fn scope_malformed_maps_to_internal() {
        assert_eq!(
            kind_of(ScopeError::Malformed(1, "bad datetime".to_string())),
            WireErrorKind::Internal
        );
    }

    #[test]
    fn scope_unsupported_kind_maps_to_invalid_request() {
        assert_eq!(
            kind_of(ScopeError::UnsupportedKind("exact")),
            WireErrorKind::InvalidRequest
        );
    }

    #[test]
    fn scope_database_maps_to_database() {
        assert_eq!(
            kind_of(ScopeError::Database(sqlx::Error::RowNotFound)),
            WireErrorKind::Database
        );
    }

    // --- KnowledgeBaseError ---

    #[test]
    fn knowledge_base_person_not_found_maps_to_not_found() {
        assert_eq!(
            kind_of(KnowledgeBaseError::PersonNotFound(1)),
            WireErrorKind::NotFound
        );
    }

    #[test]
    fn knowledge_base_event_not_found_maps_to_not_found() {
        assert_eq!(
            kind_of(KnowledgeBaseError::EventNotFound(1)),
            WireErrorKind::NotFound
        );
    }

    #[test]
    fn knowledge_base_thread_not_found_maps_to_not_found() {
        assert_eq!(
            kind_of(KnowledgeBaseError::ThreadNotFound(1)),
            WireErrorKind::NotFound
        );
    }

    #[test]
    fn knowledge_base_database_maps_to_database() {
        assert_eq!(
            kind_of(KnowledgeBaseError::Database(sqlx::Error::RowNotFound)),
            WireErrorKind::Database
        );
    }

    // --- FlowError ---

    #[test]
    fn flow_not_found_maps_to_not_found() {
        assert_eq!(kind_of(FlowError::NotFound(1)), WireErrorKind::NotFound);
    }

    #[test]
    fn flow_database_maps_to_database() {
        assert_eq!(
            kind_of(FlowError::Database(sqlx::Error::RowNotFound)),
            WireErrorKind::Database
        );
    }

    #[test]
    fn flow_nested_scope_error_maps_by_walking_into_it() {
        assert_eq!(
            kind_of(FlowError::Scope(ScopeError::NotFound(1))),
            WireErrorKind::NotFound
        );
    }

    #[test]
    fn flow_nested_task_error_maps_by_walking_into_it() {
        assert_eq!(
            kind_of(FlowError::Task(TaskError::ScopeContainment(
                "nope".to_string()
            ))),
            WireErrorKind::ContainmentViolated
        );
    }

    #[test]
    fn flow_invalid_maps_to_invalid_request() {
        assert_eq!(
            kind_of(FlowError::Invalid("no scope, but anchor given".to_string())),
            WireErrorKind::InvalidRequest
        );
    }

    // --- AppError::Database (infos / block_reasons repositories) ---

    #[test]
    fn app_error_database_row_not_found_maps_to_not_found() {
        assert_eq!(
            kind_of(AppError::Database(sqlx::Error::RowNotFound)),
            WireErrorKind::NotFound
        );
    }

    #[test]
    fn app_error_database_maps_to_database() {
        assert_eq!(
            kind_of(AppError::Database(sqlx::Error::Protocol(
                "mock error".to_string()
            ))),
            WireErrorKind::Database
        );
    }

    // --- kind serialisation spellings ---

    /// Every `WireErrorKind` variant's expected snake_case spelling. Matched
    /// exhaustively with no wildcard, so adding a variant without adding an
    /// arm here is a compile error rather than a silently-passing test.
    fn spelling(kind: WireErrorKind) -> &'static str {
        match kind {
            WireErrorKind::NotFound => "not_found",
            WireErrorKind::ContainmentViolated => "containment_violated",
            WireErrorKind::InvalidRequest => "invalid_request",
            WireErrorKind::NeedsConfirmation => "needs_confirmation",
            WireErrorKind::NeedsTimeScope => "needs_time_scope",
            WireErrorKind::Database => "database",
            WireErrorKind::Internal => "internal",
        }
    }

    #[test]
    fn kind_serialises_to_expected_snake_case_spellings() {
        let kinds = [
            WireErrorKind::NotFound,
            WireErrorKind::ContainmentViolated,
            WireErrorKind::InvalidRequest,
            WireErrorKind::NeedsConfirmation,
            WireErrorKind::NeedsTimeScope,
            WireErrorKind::Database,
            WireErrorKind::Internal,
        ];
        for kind in kinds {
            assert_eq!(
                serde_json::to_value(kind).expect("serialise"),
                serde_json::json!(spelling(kind))
            );
        }
    }

    // --- WireError shape ---

    #[test]
    fn wire_error_preserves_the_source_error_message() {
        let wire = WireError::from_error(DomainError::NotFound(42));
        assert_eq!(wire.message, "domain 42 not found");
    }

    #[test]
    fn wire_error_details_is_none_by_default() {
        let wire = WireError::from_error(DomainError::NotFound(42));
        assert_eq!(wire.details, None);
    }

    #[test]
    fn wire_error_serialises_without_a_details_field_when_none() {
        let wire = WireError::from_error(DomainError::NotFound(42));
        let value = serde_json::to_value(&wire).expect("serialise");
        let object = value
            .as_object()
            .expect("wire error serialises to an object");
        assert_eq!(object.get("kind"), Some(&serde_json::json!("not_found")));
        assert_eq!(
            object.get("message"),
            Some(&serde_json::json!("domain 42 not found"))
        );
        assert!(!object.contains_key("details"));
    }

    #[test]
    fn needs_confirmation_carries_its_details_through_to_the_serialised_form() {
        let wire = WireError::needs_confirmation(
            "retyping this goal would lose 1 child",
            serde_json::json!({ "lost_children": [{ "kind": "goal", "id": 4 }] }),
        );
        assert_eq!(wire.kind, WireErrorKind::NeedsConfirmation);

        let value = serde_json::to_value(&wire).expect("serialise");
        let object = value
            .as_object()
            .expect("wire error serialises to an object");
        assert_eq!(
            object.get("kind"),
            Some(&serde_json::json!("needs_confirmation"))
        );
        assert_eq!(
            object.get("details"),
            Some(&serde_json::json!({ "lost_children": [{ "kind": "goal", "id": 4 }] })),
            "the payload is what makes the refusal answerable"
        );
    }

    #[test]
    fn invalid_request_builds_an_invalid_request_kind_with_the_given_message_and_no_details() {
        let wire = WireError::invalid_request("invalid date: bad input");
        assert_eq!(wire.kind, WireErrorKind::InvalidRequest);
        assert_eq!(wire.message, "invalid date: bad input");
        assert_eq!(wire.details, None);

        let value = serde_json::to_value(&wire).expect("serialise");
        let object = value
            .as_object()
            .expect("wire error serialises to an object");
        assert_eq!(
            object.get("kind"),
            Some(&serde_json::json!("invalid_request"))
        );
        assert_eq!(
            object.get("message"),
            Some(&serde_json::json!("invalid date: bad input"))
        );
        assert!(!object.contains_key("details"));
    }
}
