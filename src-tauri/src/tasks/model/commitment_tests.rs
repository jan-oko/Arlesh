use super::*;

#[test]
fn verdict_as_str_covers_all_variants() {
    assert_eq!(Verdict::Unresolved.as_str(), "unresolved");
    assert_eq!(Verdict::Kept.as_str(), "kept");
    assert_eq!(Verdict::Broken.as_str(), "broken");
}

#[test]
fn verdict_from_db_roundtrips_every_variant() {
    for verdict in [Verdict::Unresolved, Verdict::Kept, Verdict::Broken] {
        assert_eq!(Verdict::from_db(verdict.as_str()), Some(verdict));
    }
}

#[test]
fn verdict_from_db_rejects_the_task_and_goal_vocabularies() {
    // A commitment is neither done nor achieved: it is kept or broken, and a row spelling a
    // Task's or a Goal's word for resolution is corrupt rather than translatable.
    assert_eq!(Verdict::from_db("done"), None);
    assert_eq!(Verdict::from_db("achieved"), None);
    assert_eq!(Verdict::from_db("bogus"), None);
}

#[test]
fn an_unjudged_commitment_is_unresolved() {
    assert_eq!(Verdict::default(), Verdict::Unresolved);
}

#[test]
fn only_kept_and_broken_count_as_having_said_something() {
    assert!(!Verdict::Unresolved.is_resolved());
    assert!(Verdict::Kept.is_resolved());
    assert!(Verdict::Broken.is_resolved());
}

#[test]
fn commitment_id_roundtrip() {
    let id = CommitmentId::from(21_i64);
    assert_eq!(i64::from(id), 21);
}
#[test]
fn an_unflagged_task_inherits() {
    assert_eq!(TaskAgentic::default(), TaskAgentic::Inherit);
}

#[test]
fn agentic_states_roundtrip_through_the_column() {
    for agentic in [TaskAgentic::Inherit, TaskAgentic::Yes, TaskAgentic::No] {
        assert_eq!(TaskAgentic::from_column(agentic.as_column()), agentic);
    }
}

#[test]
fn inherit_is_the_null_column_and_the_other_two_are_the_booleans() {
    assert_eq!(TaskAgentic::Inherit.as_column(), None);
    assert_eq!(TaskAgentic::Yes.as_column(), Some(true));
    assert_eq!(TaskAgentic::No.as_column(), Some(false));
}

#[test]
fn agentic_as_str_covers_all_variants() {
    assert_eq!(TaskAgentic::Inherit.as_str(), "inherit");
    assert_eq!(TaskAgentic::Yes.as_str(), "yes");
    assert_eq!(TaskAgentic::No.as_str(), "no");
}

/// The reason the three states are a named enum rather than an `Option<Option<bool>>`: over
/// IPC, serde reads an explicit `null` as an absent field, so the nested shape cannot say
/// "put this back to inheriting" at all — the clear would arrive as "leave it alone" and do
/// nothing, silently. Naming the states keeps *absent* and *inherit* distinguishable on the
/// wire, which is what this test pins.
#[test]
fn an_update_request_tells_leave_it_alone_apart_from_put_it_back_to_inheriting() {
    let untouched: UpdateTaskRequest = serde_json::from_str("{}").unwrap();
    assert_eq!(untouched.agentic, None);

    let cleared: UpdateTaskRequest = serde_json::from_str(r#"{"agentic":"inherit"}"#).unwrap();
    assert_eq!(cleared.agentic, Some(TaskAgentic::Inherit));

    let flagged: UpdateTaskRequest = serde_json::from_str(r#"{"agentic":"yes"}"#).unwrap();
    assert_eq!(flagged.agentic, Some(TaskAgentic::Yes));

    let unflagged: UpdateTaskRequest = serde_json::from_str(r#"{"agentic":"no"}"#).unwrap();
    assert_eq!(unflagged.agentic, Some(TaskAgentic::No));
}
