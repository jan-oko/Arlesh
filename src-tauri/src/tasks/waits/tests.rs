use super::*;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").expect("a parseable instant")
}

fn every(n: i64, kind: &str) -> DurationSpec {
    DurationSpec {
        n,
        kind: kind.to_string(),
    }
}

#[test]
fn the_first_check_is_due_at_starting() {
    let starting = at("2026-07-01T09:00:00");
    assert_eq!(
        next_check_due(&every(3, "day"), starting, None),
        Some(starting)
    );
}

#[test]
fn the_next_check_is_one_interval_after_the_last_check_made_not_after_the_schedule() {
    // Starting on the 1st, every 3 days — but checked late, on the 9th. The next is the 12th,
    // not the 4th or the 10th: a late check does not leave a run of overdue ones behind it.
    let next = next_check_due(
        &every(3, "day"),
        at("2026-07-01T09:00:00"),
        Some(at("2026-07-09T18:30:00")),
    );
    assert_eq!(next, Some(at("2026-07-12T18:30:00")));
    let monthly = next_check_due(
        &every(1, "month"),
        at("2026-07-01T09:00:00"),
        Some(at("2026-07-15T00:00:00")),
    );
    assert_eq!(monthly, Some(at("2026-08-15T00:00:00")));
}

#[test]
fn an_uncountable_interval_has_no_next_check() {
    assert_eq!(
        next_check_due(
            &every(2, "part"),
            at("2026-07-01T09:00:00"),
            Some(at("2026-07-02T09:00:00"))
        ),
        None
    );
}

#[test]
fn an_instant_round_trips_through_its_column_and_garbage_reads_as_absent() {
    let instant = at("2026-07-01T09:05:07");
    assert_eq!(
        instant_from_column(Some(instant_column(instant))),
        Some(instant)
    );
    assert_eq!(instant_from_column(Some("yesterday".to_string())), None);
    assert_eq!(instant_from_column(None), None);
}

#[test]
fn a_duration_needs_both_halves() {
    assert_eq!(
        duration(Some(2), Some("week".to_string())),
        Some(every(2, "week"))
    );
    assert_eq!(duration(Some(2), None), None);
    assert_eq!(
        columns(&Some(every(2, "week"))),
        (Some(2), Some("week".to_string()))
    );
    assert_eq!(columns(&None), (None, None));
}

#[test]
fn only_the_four_coarse_kinds_are_counted() {
    for kind in ["day", "week", "month", "season"] {
        assert!(scope_kind(kind).is_some(), "{kind}");
    }
    assert!(scope_kind("part").is_none());
}
