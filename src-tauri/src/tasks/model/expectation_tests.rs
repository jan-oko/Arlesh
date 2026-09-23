use super::*;

#[test]
fn expectation_status_roundtrips_every_variant() {
    for status in [ExpectationStatus::Pending, ExpectationStatus::Released] {
        assert_eq!(ExpectationStatus::from_db(status.as_str()), Some(status));
    }
    assert_eq!(ExpectationStatus::Pending.as_str(), "pending");
    assert_eq!(ExpectationStatus::Released.as_str(), "released");
}

#[test]
fn expectation_status_rejects_the_task_vocabulary() {
    // A wait is released, not done: a row spelling a Task's word is corrupt, not translatable.
    assert_eq!(ExpectationStatus::from_db("done"), None);
    assert_eq!(ExpectationStatus::from_db("todo"), None);
}

#[test]
fn a_new_expectation_is_pending_and_live() {
    assert_eq!(ExpectationStatus::default(), ExpectationStatus::Pending);
    assert_eq!(ExpectationArchival::default(), ExpectationArchival::Live);
}

#[test]
fn expectation_archival_roundtrips_every_variant() {
    for archival in [ExpectationArchival::Live, ExpectationArchival::Archived] {
        assert_eq!(
            ExpectationArchival::from_db(archival.as_str()),
            Some(archival)
        );
    }
    assert_eq!(ExpectationArchival::from_db("backlog"), None);
}

#[test]
fn expectation_id_roundtrip() {
    let id = ExpectationId::from(9_i64);
    assert_eq!(i64::from(id), 9);
}

#[test]
fn an_expectation_dependency_serialises_under_its_own_tag() {
    let json = serde_json::to_value(Dependency::Expectation { id: 4 }).expect("serialises");
    assert_eq!(json, serde_json::json!({ "type": "expectation", "id": 4 }));
}

#[test]
fn an_explicit_null_check_every_clears_it_and_an_absent_one_leaves_it() {
    let clear: UpdateExpectationRequest =
        serde_json::from_value(serde_json::json!({ "check_every": null })).expect("parses");
    assert!(matches!(clear.check_every, Some(None)));
    let leave: UpdateExpectationRequest =
        serde_json::from_value(serde_json::json!({})).expect("parses");
    assert!(leave.check_every.is_none());
}

#[test]
fn an_explicit_null_template_removes_it() {
    let clear: UpdateTaskRequest =
        serde_json::from_value(serde_json::json!({ "async_template": null })).expect("parses");
    assert!(matches!(clear.async_template, Some(None)));
}
