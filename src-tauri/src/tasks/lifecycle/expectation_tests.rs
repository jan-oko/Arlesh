use super::*;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").expect("a parseable instant")
}

fn one_day() -> Option<Bounds> {
    Some((at("2026-01-06T00:00:00"), at("2026-01-07T00:00:00")))
}

#[test]
fn no_check_by_is_always_active_and_never_late() {
    let state = derive_expectation_state(
        None,
        ExpectationStatus::Pending,
        ExpectationArchival::Live,
        at("2030-01-01T00:00:00"),
    );
    assert_eq!(state.timing, Timing::Active);
    assert_eq!(state.resolution, None);
    assert_eq!(state.archival, Archival::Live);
}

#[test]
fn a_check_by_ahead_is_pending_and_one_running_is_active() {
    let ahead = derive_expectation_state(
        one_day(),
        ExpectationStatus::Pending,
        ExpectationArchival::Live,
        at("2026-01-05T12:00:00"),
    );
    assert_eq!(ahead.timing, Timing::Pending);
    let running = derive_expectation_state(
        one_day(),
        ExpectationStatus::Pending,
        ExpectationArchival::Live,
        at("2026-01-06T12:00:00"),
    );
    assert_eq!(running.timing, Timing::Active);
}

#[test]
fn a_passed_check_by_on_a_pending_wait_is_overdue_and_stays_live() {
    let state = derive_expectation_state(
        one_day(),
        ExpectationStatus::Pending,
        ExpectationArchival::Live,
        at("2026-01-08T00:00:00"),
    );
    assert_eq!(state.timing, Timing::Lapsed);
    assert_eq!(state.resolution, Some(Resolution::Overdue));
    assert_eq!(state.archival, Archival::Live);
}

#[test]
fn a_released_wait_has_nothing_to_be_late_for() {
    let state = derive_expectation_state(
        one_day(),
        ExpectationStatus::Released,
        ExpectationArchival::Live,
        at("2026-01-08T00:00:00"),
    );
    assert_eq!(state.resolution, None);
}

#[test]
fn the_stored_archive_is_the_archival() {
    let state = derive_expectation_state(
        None,
        ExpectationStatus::Pending,
        ExpectationArchival::Archived,
        at("2026-01-08T00:00:00"),
    );
    assert_eq!(state.archival, Archival::Archived);
    assert!(!state.archival_conflict);
}
