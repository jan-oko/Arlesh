use super::*;
use chrono::TimeZone;

fn at(zone: &str, instant: DateTime<Utc>) -> String {
    let zone: Tz = zone.parse().expect("a zone");
    wall_clock_at(instant, Some(zone)).to_string()
}

#[test]
fn the_same_instant_is_another_day_in_another_zone() {
    // 23:30 UTC on the 13th: already the 14th in Tokyo, still the 13th in Los Angeles.
    let instant = Utc.with_ymd_and_hms(2026, 11, 13, 23, 30, 0).unwrap();

    assert_eq!(at("Asia/Tokyo", instant), "2026-11-14 08:30:00");
    assert_eq!(at("America/Los_Angeles", instant), "2026-11-13 15:30:00");
    assert_eq!(at("UTC", instant), "2026-11-13 23:30:00");
}

#[test]
fn a_zone_keeps_its_own_daylight_saving() {
    let winter = Utc.with_ymd_and_hms(2026, 1, 15, 12, 0, 0).unwrap();
    let summer = Utc.with_ymd_and_hms(2026, 7, 15, 12, 0, 0).unwrap();

    assert_eq!(at("Europe/Berlin", winter), "2026-01-15 13:00:00");
    assert_eq!(at("Europe/Berlin", summer), "2026-07-15 14:00:00");
}

#[test]
fn an_unknown_name_is_refused_and_says_what_it_wants() {
    let error = set_time_zone("Mars/Olympus").expect_err("not a zone");

    assert!(error.to_string().contains("Mars/Olympus"));
    assert!(error.to_string().contains("IANA"));
}
