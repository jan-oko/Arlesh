use super::*;
use crate::scopes::key::test_key;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").expect("a parseable instant")
}

fn every(n: i64, kind: &str) -> DurationSpec {
    DurationSpec {
        n,
        kind: kind.to_string(),
    }
}

fn stored() -> Expectation {
    Expectation {
        id: 1,
        title: "Training run finishes".to_string(),
        parent_type: "project".to_string(),
        parent_id: 7,
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        check_every: Some(every(3, "day")),
        check_starting: Some(at("2026-07-01T09:00:00")),
        last_check_at: None,
        time_scope: None,
        tag_ids: vec![2],
        position: 100,
        is_private: false,
    }
}

#[test]
fn an_empty_request_writes_the_stored_row_back_unchanged() {
    let write = ExpectationWrite::merge(
        stored(),
        UpdateExpectationRequest::default(),
        at("2026-07-05T10:00:00"),
    );
    assert!(write.reparent.is_none());
    assert_eq!(write.title, "Training run finishes");
    assert_eq!(write.status, ExpectationStatus::Pending);
    assert_eq!(write.archival, ExpectationArchival::Live);
    assert_eq!(write.check_every, stored().check_every);
    assert_eq!(write.check_starting, stored().check_starting);
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
        at("2026-07-05T10:00:00"),
    );
    assert_eq!(write.status, ExpectationStatus::Released);
    assert_eq!(write.check_every, stored().check_every);
    assert_eq!(write.check_starting, stored().check_starting);
    assert_eq!(write.archival, ExpectationArchival::Live);
}

#[test]
fn an_explicit_clear_stops_the_checks() {
    let write = ExpectationWrite::merge(
        stored(),
        UpdateExpectationRequest {
            check_every: Some(None),
            ..Default::default()
        },
        at("2026-07-05T10:00:00"),
    );
    assert!(write.check_every.is_none());
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
        at("2026-07-05T10:00:00"),
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
        at("2026-07-05T10:00:00"),
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
        check_every_n: Some(2),
        check_every_kind: Some("week".to_string()),
        check_starting: Some("2026-07-01T09:00:00".to_string()),
        checked_at: Some("not a date".to_string()),
        position: 0,
        is_private: true,
        time_scope_start_id: Some(test_key(4)),
        time_scope_end_id: Some(test_key(5)),
        time_scope_duration_n: None,
        time_scope_duration_kind: None,
    };
    let expectation = Expectation::from(row);
    assert_eq!(expectation.status, ExpectationStatus::Pending);
    assert_eq!(expectation.archival, ExpectationArchival::Live);
    assert_eq!(expectation.check_every, Some(every(2, "week")));
    assert_eq!(expectation.check_starting, Some(at("2026-07-01T09:00:00")));
    assert!(
        expectation.last_check_at.is_none(),
        "an unreadable instant reads as absent"
    );
    assert!(expectation.is_private);
    assert_eq!(
        expectation.time_scope,
        Some(TimeScope {
            start_id: test_key(4),
            end_id: test_key(5),
            duration: None
        })
    );
    assert!(expectation.tag_ids.is_empty());
}

#[test]
fn a_time_scope_can_be_set_and_cleared_like_a_tasks() {
    let window = TimeScope {
        start_id: test_key(7),
        end_id: test_key(8),
        duration: None,
    };
    let set = ExpectationWrite::merge(
        stored(),
        UpdateExpectationRequest {
            time_scope: Some(Some(window.clone())),
            ..Default::default()
        },
        at("2026-07-05T10:00:00"),
    );
    assert_eq!(set.time_scope, Some(window.clone()));
    let scoped = Expectation {
        time_scope: Some(window),
        ..stored()
    };
    let cleared = ExpectationWrite::merge(
        scoped,
        UpdateExpectationRequest {
            time_scope: Some(None),
            ..Default::default()
        },
        at("2026-07-05T10:00:00"),
    );
    assert!(cleared.time_scope.is_none());
    assert_eq!(cleared.parent_type, "project");
    assert_eq!(cleared.parent_id, 7);
}

#[test]
fn a_check_every_newly_given_starts_now_unless_it_names_a_starting() {
    let unchecked = Expectation {
        check_every: None,
        check_starting: None,
        ..stored()
    };
    let now = at("2026-07-05T10:00:00");
    let starts_now = ExpectationWrite::merge(
        unchecked.clone(),
        UpdateExpectationRequest {
            check_every: Some(Some(every(1, "week"))),
            ..Default::default()
        },
        now,
    );
    assert_eq!(starts_now.check_starting, Some(now));
    let named = ExpectationWrite::merge(
        unchecked,
        UpdateExpectationRequest {
            check_every: Some(Some(every(1, "week"))),
            check_starting: Some(at("2026-08-01T00:00:00")),
            ..Default::default()
        },
        now,
    );
    assert_eq!(named.check_starting, Some(at("2026-08-01T00:00:00")));
    // An existing chain keeps its Starting when only its interval changes.
    let changed = ExpectationWrite::merge(
        stored(),
        UpdateExpectationRequest {
            check_every: Some(Some(every(5, "day"))),
            ..Default::default()
        },
        now,
    );
    assert_eq!(changed.check_starting, stored().check_starting);
}

#[test]
fn every_columns_needs_a_duration() {
    assert_eq!(
        every_columns(&Some(every(2, "day"))),
        (Some(2), Some("day".to_string()))
    );
    assert_eq!(every_columns(&None), (None, None));
}
