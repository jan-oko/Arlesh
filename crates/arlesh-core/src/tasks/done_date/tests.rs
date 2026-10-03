use super::*;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

#[test]
fn a_done_task_may_be_dated_back() {
    let now = at("2026-10-01T12:00:00");
    assert!(check_done_date(true, at("2026-09-26T19:00:00"), now).is_ok());
    assert!(check_done_date(true, now, now).is_ok());
}

#[test]
fn a_done_date_in_the_future_is_refused() {
    let now = at("2026-10-01T12:00:00");
    assert!(matches!(
        check_done_date(true, at("2026-10-01T12:00:01"), now),
        Err(TaskError::DoneInFuture)
    ));
}

#[test]
fn a_task_that_is_not_done_has_no_done_date_to_set() {
    let now = at("2026-10-01T12:00:00");
    assert!(matches!(
        check_done_date(false, at("2026-09-26T19:00:00"), now),
        Err(TaskError::NotDone)
    ));
}
