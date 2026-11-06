use super::*;

fn at(text: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S").unwrap()
}

#[test]
fn a_pin_lives_until_it_lapses() {
    let lapses = at("2026-11-07T10:05:00");

    assert!(live(lapses, at("2026-11-07T10:04:59")));
    assert!(!live(lapses, at("2026-11-07T10:05:00")));
}

#[test]
fn the_door_shuts_after_five_wrong_pins_within_ten_minutes() {
    let failures: Vec<_> = (0..5).map(|n| at(&format!("2026-11-07T10:0{n}:00"))).collect();

    assert!(locked_out(&failures, at("2026-11-07T10:09:00")));
    assert!(!locked_out(&failures[..4], at("2026-11-07T10:09:00")));
}

#[test]
fn old_failures_are_forgotten() {
    let failures: Vec<_> = (0..5).map(|n| at(&format!("2026-11-07T10:0{n}:00"))).collect();

    assert!(!locked_out(&failures, at("2026-11-07T10:20:00")));
}
