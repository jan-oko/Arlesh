use super::*;

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}
fn dt(y: i32, m: u32, day: u32, h: u32, min: u32) -> NaiveDateTime {
    d(y, m, day).and_hms_opt(h, min, 0).unwrap()
}

#[test]
fn canonical_day_spans_one_full_day_half_open() {
    let bounds = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
    assert_eq!(bounds.0, dt(2026, 6, 20, 0, 0));
    assert_eq!(bounds.1, dt(2026, 6, 21, 0, 0));
}

#[test]
fn canonical_week_ends_at_midnight_after_last_day() {
    let bounds = canonical_bounds(d(2026, 6, 14), d(2026, 6, 20));
    assert_eq!(bounds.0, dt(2026, 6, 14, 0, 0));
    assert_eq!(bounds.1, dt(2026, 6, 21, 0, 0));
}

#[test]
fn part_of_day_morning_is_06_to_12_same_day() {
    let bounds = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Morning);
    assert_eq!(bounds.0, dt(2026, 6, 20, 6, 0));
    assert_eq!(bounds.1, dt(2026, 6, 20, 12, 0));
}

#[test]
fn part_of_day_night_wraps_to_next_day_at_02() {
    let bounds = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Night);
    assert_eq!(bounds.0, dt(2026, 6, 20, 22, 0));
    assert_eq!(bounds.1, dt(2026, 6, 21, 2, 0));
}

#[test]
fn part_of_day_premorning_is_02_to_06() {
    let bounds = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Premorning);
    assert_eq!(bounds.0, dt(2026, 6, 20, 2, 0));
    assert_eq!(bounds.1, dt(2026, 6, 20, 6, 0));
}

#[test]
fn active_includes_start_excludes_end() {
    let bounds = (dt(2026, 6, 20, 0, 0), dt(2026, 6, 21, 0, 0));
    assert!(is_active_at(bounds, dt(2026, 6, 20, 0, 0)));
    assert!(is_active_at(bounds, dt(2026, 6, 20, 23, 59)));
    assert!(!is_active_at(bounds, dt(2026, 6, 21, 0, 0)));
    assert!(!is_active_at(bounds, dt(2026, 6, 19, 23, 59)));
}

#[test]
fn a_night_instant_after_midnight_is_active_in_the_starting_days_night() {
    let night = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Night);
    assert!(is_active_at(night, dt(2026, 6, 21, 1, 0)));
    assert!(!is_active_at(night, dt(2026, 6, 21, 2, 0)));
}

#[test]
fn containment_is_inclusive_at_both_edges() {
    let week = canonical_bounds(d(2026, 6, 14), d(2026, 6, 20));
    let day = canonical_bounds(d(2026, 6, 17), d(2026, 6, 17));
    assert!(interval_contains(week, day));
    assert!(interval_contains(week, week));
}

#[test]
fn containment_rejects_partial_overlap_and_supersets() {
    let week = canonical_bounds(d(2026, 6, 14), d(2026, 6, 20));
    let next_day = canonical_bounds(d(2026, 6, 21), d(2026, 6, 21));
    let month = canonical_bounds(d(2026, 6, 1), d(2026, 6, 30));
    assert!(!interval_contains(week, next_day));
    assert!(!interval_contains(week, month));
}

#[test]
fn a_part_of_day_is_contained_in_its_day() {
    let day = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
    let morning = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Morning);
    assert!(interval_contains(day, morning));
}

#[test]
fn night_is_not_contained_in_its_starting_day() {
    // Night runs into the next day, so it is NOT a subset of the day it starts on.
    let day = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
    let night = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Night);
    assert!(!interval_contains(day, night));
}

fn mk_scope(kind: &str) -> Scope {
    Scope {
        id: 1,
        kind: kind.to_string(),
        label: "test".to_string(),
        start_date: "2026-06-20".to_string(),
        end_date: "2026-06-20".to_string(),
        week_id: None,
        month_id: None,
        season_id: None,
        day_id: None,
        part: None,
        start_datetime: None,
        end_datetime: None,
    }
}

#[test]
fn row_resolution_canonical_day() {
    let scope = mk_scope("day");
    assert_eq!(
        scope_bounds(&scope).unwrap(),
        (dt(2026, 6, 20, 0, 0), dt(2026, 6, 21, 0, 0))
    );
}

#[test]
fn row_resolution_part_of_day_night() {
    let mut scope = mk_scope("part_of_day");
    scope.part = Some("night".to_string());
    assert_eq!(
        scope_bounds(&scope).unwrap(),
        (dt(2026, 6, 20, 22, 0), dt(2026, 6, 21, 2, 0))
    );
}

#[test]
fn row_resolution_exact_uses_stored_datetimes() {
    let mut scope = mk_scope("exact");
    scope.start_datetime = Some("2026-06-20T09:30:00".to_string());
    scope.end_datetime = Some("2026-06-22T14:00:00".to_string());
    assert_eq!(
        scope_bounds(&scope).unwrap(),
        (dt(2026, 6, 20, 9, 30), dt(2026, 6, 22, 14, 0))
    );
}

#[test]
fn row_resolution_active_check_on_a_row() {
    let scope = mk_scope("day");
    assert!(scope_is_active(&scope, dt(2026, 6, 20, 10, 0)).unwrap());
    assert!(!scope_is_active(&scope, dt(2026, 6, 21, 10, 0)).unwrap());
}

#[test]
fn row_resolution_rejects_unknown_kind_and_missing_part() {
    assert!(scope_bounds(&mk_scope("decade")).is_err());
    assert!(scope_bounds(&mk_scope("part_of_day")).is_err()); // part is None
    let mut exact = mk_scope("exact");
    exact.start_datetime = Some("2026-06-20T09:30:00".to_string()); // end missing
    assert!(scope_bounds(&exact).is_err());
}
