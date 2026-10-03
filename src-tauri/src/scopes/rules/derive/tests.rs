use super::*;
use chrono::NaiveDate;

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

// --- scope_dates: Day ---

#[test]
fn bounds_day_is_single_date() {
    let date = d(2026, 6, 20);
    assert_eq!(scope_dates(CanonicalKind::Day, date), (date, date));
}

// --- scope_dates: Week ---

#[test]
fn bounds_week_saturday_starts_on_sunday() {
    // 2026-06-20 is Saturday
    let (start, end) = scope_dates(CanonicalKind::Week, d(2026, 6, 20));
    assert_eq!(start, d(2026, 6, 14));
    assert_eq!(end, d(2026, 6, 20));
}

#[test]
fn bounds_week_wednesday_same_sunday_anchor() {
    // 2026-06-17 is Wednesday → same week as the Saturday above
    let (start, end) = scope_dates(CanonicalKind::Week, d(2026, 6, 17));
    assert_eq!(start, d(2026, 6, 14));
    assert_eq!(end, d(2026, 6, 20));
}

#[test]
fn bounds_week_sunday_is_its_own_start() {
    let (start, _end) = scope_dates(CanonicalKind::Week, d(2026, 6, 14));
    assert_eq!(start, d(2026, 6, 14));
}

// --- scope_dates: Month ---

#[test]
fn bounds_month_june_ends_on_30() {
    let (start, end) = scope_dates(CanonicalKind::Month, d(2026, 6, 15));
    assert_eq!(start, d(2026, 6, 1));
    assert_eq!(end, d(2026, 6, 30));
}

#[test]
fn bounds_month_december_stays_within_year() {
    let (start, end) = scope_dates(CanonicalKind::Month, d(2026, 12, 15));
    assert_eq!(start, d(2026, 12, 1));
    assert_eq!(end, d(2026, 12, 31));
}

#[test]
fn bounds_month_february_non_leap_ends_on_28() {
    let (start, end) = scope_dates(CanonicalKind::Month, d(2026, 2, 10));
    assert_eq!(start, d(2026, 2, 1));
    assert_eq!(end, d(2026, 2, 28));
}

#[test]
fn bounds_month_february_leap_ends_on_29() {
    let (start, end) = scope_dates(CanonicalKind::Month, d(2024, 2, 15));
    assert_eq!(start, d(2024, 2, 1));
    assert_eq!(end, d(2024, 2, 29));
}

// --- scope_dates: Season ---

#[test]
fn bounds_season_summer_june_to_august() {
    let (start, end) = scope_dates(CanonicalKind::Season, d(2026, 6, 20));
    assert_eq!(start, d(2026, 6, 1));
    assert_eq!(end, d(2026, 8, 31));
}

#[test]
fn bounds_season_autumn_september_to_november() {
    let (start, end) = scope_dates(CanonicalKind::Season, d(2026, 10, 1));
    assert_eq!(start, d(2026, 9, 1));
    assert_eq!(end, d(2026, 11, 30));
}

#[test]
fn bounds_season_spring_march_to_may() {
    let (start, end) = scope_dates(CanonicalKind::Season, d(2026, 4, 15));
    assert_eq!(start, d(2026, 3, 1));
    assert_eq!(end, d(2026, 5, 31));
}

#[test]
fn bounds_season_winter_december_crosses_year() {
    let (start, end) = scope_dates(CanonicalKind::Season, d(2026, 12, 1));
    assert_eq!(start, d(2026, 12, 1));
    assert_eq!(end, d(2027, 2, 28));
}

#[test]
fn bounds_season_winter_january_traces_to_december() {
    let (start, end) = scope_dates(CanonicalKind::Season, d(2027, 1, 15));
    assert_eq!(start, d(2026, 12, 1));
    assert_eq!(end, d(2027, 2, 28));
}

// --- scope_label ---

#[test]
fn label_day_formats_as_iso() {
    assert_eq!(
        scope_label(CanonicalKind::Day, d(2026, 6, 20)),
        "2026-06-20"
    );
}

#[test]
fn label_month_is_full_name_and_year() {
    assert_eq!(
        scope_label(CanonicalKind::Month, d(2026, 6, 15)),
        "June 2026"
    );
}

#[test]
fn label_season_summer() {
    assert_eq!(
        scope_label(CanonicalKind::Season, d(2026, 7, 1)),
        "Summer 2026"
    );
}

#[test]
fn label_season_winter_december_uses_start_year() {
    assert_eq!(
        scope_label(CanonicalKind::Season, d(2026, 12, 1)),
        "Winter 2026"
    );
}

#[test]
fn label_week_contains_number_and_year() {
    let label = scope_label(CanonicalKind::Week, d(2026, 6, 14));
    assert_eq!(label, "Week 25 2026");
}

#[test]
fn a_week_across_new_year_is_labelled_from_its_sunday() {
    // 2026-12-27 is a Sunday; the week runs into 2027 and still reads as 2026's last week.
    assert_eq!(
        scope_label(CanonicalKind::Week, d(2026, 12, 27)),
        "Week 53 2026"
    );
}

// --- week_number ---

#[test]
fn week_number_jan1_is_1() {
    assert_eq!(week_number(d(2026, 1, 1)), 1);
}

#[test]
fn week_number_mid_year_in_expected_range() {
    let w = week_number(d(2026, 6, 20));
    assert!(
        (24..=26).contains(&w),
        "week {w} out of expected range 24–26"
    );
}

// --- season_name_and_year ---

#[test]
fn season_name_all_start_months() {
    assert_eq!(season_name_and_year(d(2026, 3, 1)), ("Spring", 2026));
    assert_eq!(season_name_and_year(d(2026, 6, 1)), ("Summer", 2026));
    assert_eq!(season_name_and_year(d(2026, 9, 1)), ("Autumn", 2026));
    assert_eq!(season_name_and_year(d(2026, 12, 1)), ("Winter", 2026));
    assert_eq!(season_name_and_year(d(2027, 1, 1)), ("Winter", 2026));
    assert_eq!(season_name_and_year(d(2026, 2, 28)), ("Winter", 2025));
}

// --- every date of a scope agrees on it ---

#[test]
fn every_day_of_a_season_names_the_same_season() {
    let mut date = d(2026, 12, 1);
    while date <= d(2027, 2, 28) {
        assert_eq!(
            scope_dates(CanonicalKind::Season, date),
            (d(2026, 12, 1), d(2027, 2, 28)),
            "{date}"
        );
        date = date.succ_opt().unwrap();
    }
}

#[test]
fn every_month_of_a_leap_year_ends_on_its_last_day() {
    let lengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (month0, length) in lengths.iter().enumerate() {
        let month = u32::try_from(month0).unwrap() + 1;
        assert_eq!(
            scope_dates(CanonicalKind::Month, d(2028, month, 10)),
            (d(2028, month, 1), d(2028, month, *length))
        );
    }
}
