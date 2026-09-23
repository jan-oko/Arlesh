use super::*;

fn stored() -> Expectation {
    Expectation {
        id: 1,
        title: "Training run finishes".to_string(),
        parent_type: "project".to_string(),
        parent_id: 7,
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        check_by: Some(TimeScope {
            start_id: 10,
            end_id: 10,
            duration: None,
        }),
        position: 100,
        is_private: false,
    }
}

#[test]
fn an_empty_request_writes_the_stored_row_back_unchanged() {
    let write = ExpectationWrite::merge(stored(), UpdateExpectationRequest::default());
    assert!(write.reparent.is_none());
    assert_eq!(write.title, "Training run finishes");
    assert_eq!(write.status, ExpectationStatus::Pending);
    assert_eq!(write.archival, ExpectationArchival::Live);
    assert_eq!(write.check_by, stored().check_by);
    assert_eq!(write.position, 100);
    assert!(!write.is_private);
}

#[test]
fn releasing_changes_the_status_and_nothing_else() {
    let write = ExpectationWrite::merge(
        stored(),
        UpdateExpectationRequest {
            status: Some(ExpectationStatus::Released),
            ..Default::default()
        },
    );
    assert_eq!(write.status, ExpectationStatus::Released);
    assert_eq!(write.check_by, stored().check_by);
    assert_eq!(write.archival, ExpectationArchival::Live);
}

#[test]
fn an_explicit_clear_drops_the_check_by() {
    let write = ExpectationWrite::merge(
        stored(),
        UpdateExpectationRequest {
            check_by: Some(None),
            ..Default::default()
        },
    );
    assert!(write.check_by.is_none());
    assert_eq!(write.status, ExpectationStatus::Pending);
}

#[test]
fn a_move_needs_both_halves_of_the_parent_link() {
    let half = ExpectationWrite::merge(
        stored(),
        UpdateExpectationRequest {
            parent_type: Some("task".to_string()),
            ..Default::default()
        },
    );
    assert!(half.reparent.is_none());
    let whole = ExpectationWrite::merge(
        stored(),
        UpdateExpectationRequest {
            parent_type: Some("task".to_string()),
            parent_id: Some(3),
            title: Some("Reply".to_string()),
            archival: Some(ExpectationArchival::Archived),
            position: Some(5),
            is_private: Some(true),
            ..Default::default()
        },
    );
    assert_eq!(whole.reparent, Some(("task".to_string(), 3)));
    assert_eq!(whole.title, "Reply");
    assert_eq!(whole.archival, ExpectationArchival::Archived);
    assert_eq!(whole.position, 5);
    assert!(whole.is_private);
}

#[test]
fn an_unrecognised_stored_status_reads_as_pending() {
    let row = ExpectationRow {
        id: 2,
        title: "x".to_string(),
        parent_type: "task".to_string(),
        parent_id: 1,
        status: "bogus".to_string(),
        archival: "bogus".to_string(),
        check_by_start_id: None,
        check_by_end_id: None,
        check_by_duration_n: None,
        check_by_duration_kind: None,
        position: 0,
        is_private: true,
    };
    let expectation = Expectation::from(row);
    assert_eq!(expectation.status, ExpectationStatus::Pending);
    assert_eq!(expectation.archival, ExpectationArchival::Live);
    assert!(expectation.check_by.is_none());
    assert!(expectation.is_private);
}
