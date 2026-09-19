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
#[test]
fn an_unmatched_gesture_close_is_an_invalid_request_and_an_unreadable_source_is_internal() {
    use crate::undo::error::UndoError;

    assert_eq!(
        WireError::from_error(UndoError::NoGestureOpen).kind,
        WireErrorKind::InvalidRequest,
        "a close with no open is the caller's pairing, which the caller can fix"
    );
    assert_eq!(
        WireError::from_error(UndoError::UnknownWriteSource("scheduler".into())).kind,
        WireErrorKind::Internal,
        "a source no WriteSource names is unreadable persisted data, not a bad request"
    );
    assert_eq!(
        WireError::from_error(UndoError::Database(sqlx::Error::RowNotFound)).kind,
        WireErrorKind::Database
    );
}
