use super::*;

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}
fn dt(y: i32, m: u32, day: u32, h: u32, min: u32) -> NaiveDateTime {
    d(y, m, day).and_hms_opt(h, min, 0).unwrap()
}

#[test]
fn canonical_day_spans_one_full_day_half_open_from_02() {
    let bounds = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
    assert_eq!(bounds.0, dt(2026, 6, 20, 2, 0));
    assert_eq!(bounds.1, dt(2026, 6, 21, 2, 0));
}

#[test]
fn canonical_week_ends_at_02_after_its_last_day() {
    let bounds = canonical_bounds(d(2026, 6, 14), d(2026, 6, 20));
    assert_eq!(bounds.0, dt(2026, 6, 14, 2, 0));
    assert_eq!(bounds.1, dt(2026, 6, 21, 2, 0));
}

#[test]
fn a_day_is_exactly_the_span_between_two_boundaries() {
    let bounds = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
    assert_eq!(bounds.0, day_boundary(d(2026, 6, 20)));
    assert_eq!(bounds.1, day_boundary(d(2026, 6, 21)));
}

#[test]
fn an_instant_after_midnight_still_belongs_to_the_previous_day() {
    let day = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
    assert!(is_active_at(day, dt(2026, 6, 21, 1, 30)));
    assert!(!is_active_at(day, dt(2026, 6, 21, 2, 0)));
    assert!(!is_active_at(day, dt(2026, 6, 20, 1, 30)));
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
    let bounds = (dt(2026, 6, 20, 2, 0), dt(2026, 6, 21, 2, 0));
    assert!(is_active_at(bounds, dt(2026, 6, 20, 2, 0)));
    assert!(is_active_at(bounds, dt(2026, 6, 21, 1, 59)));
    assert!(!is_active_at(bounds, dt(2026, 6, 21, 2, 0)));
    assert!(!is_active_at(bounds, dt(2026, 6, 20, 1, 59)));
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
fn a_day_contains_all_six_of_its_own_parts() {
    let day = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
    for part in [
        PartOfDay::Premorning,
        PartOfDay::Morning,
        PartOfDay::Noon,
        PartOfDay::Afternoon,
        PartOfDay::Evening,
        PartOfDay::Night,
    ] {
        assert!(
            interval_contains(day, part_of_day_bounds(d(2026, 6, 20), part)),
            "{part:?} should be inside its own day"
        );
    }
}

#[test]
fn a_day_contains_its_own_night_past_midnight() {
    // Night runs 22:00-02:00; the day it starts on runs to 02:00 too, so it fits exactly.
    let day = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
    let night = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Night);
    assert!(interval_contains(day, night));
    assert_eq!(day.1, night.1);
}

#[test]
fn a_week_is_exactly_its_seven_days_and_a_month_its_weeks() {
    let week = canonical_bounds(d(2026, 6, 14), d(2026, 6, 20));
    let days: Vec<Bounds> = (14..=20)
        .map(|day| canonical_bounds(d(2026, 6, day), d(2026, 6, day)))
        .collect();
    for day in &days {
        assert!(interval_contains(week, *day));
    }
    assert_eq!(week.0, days[0].0);
    assert_eq!(week.1, days[6].1);
    let month = canonical_bounds(d(2026, 6, 1), d(2026, 6, 30));
    assert!(interval_contains(month, week));
}

fn key(raw: &str) -> ScopeKey {
    raw.parse().unwrap()
}

#[test]
fn key_resolution_canonical_day() {
    assert_eq!(
        key("day:2026-06-20").bounds(),
        (dt(2026, 6, 20, 2, 0), dt(2026, 6, 21, 2, 0))
    );
}

#[test]
fn key_resolution_part_of_day_night() {
    assert_eq!(
        key("part_of_day:2026-06-20:night").bounds(),
        (dt(2026, 6, 20, 22, 0), dt(2026, 6, 21, 2, 0))
    );
}

#[test]
fn key_resolution_exact_uses_its_datetimes() {
    assert_eq!(
        key("exact:2026-06-20T09:30:00/2026-06-22T14:00:00").bounds(),
        (dt(2026, 6, 20, 9, 30), dt(2026, 6, 22, 14, 0))
    );
}

#[test]
fn resolve_reports_the_window_and_whether_now_is_inside_it() {
    let day = key("day:2026-06-20");
    let resolved = resolve(&day, dt(2026, 6, 20, 10, 0));
    assert_eq!(resolved.start, "2026-06-20T02:00:00");
    assert_eq!(resolved.end, "2026-06-21T02:00:00");
    assert!(resolved.active);
    assert!(!resolve(&day, dt(2026, 6, 21, 10, 0)).active);
    // 01:30 the morning after is still inside the day, and 01:30 the morning of is not yet.
    assert!(resolve(&day, dt(2026, 6, 21, 1, 30)).active);
    assert!(!resolve(&day, dt(2026, 6, 20, 1, 30)).active);
}
