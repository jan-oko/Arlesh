use super::*;

fn at(text: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn window(kind: &str, percent: f64, resets: &str) -> Window {
    Window {
        kind: kind.to_owned(),
        percent_used: percent,
        resets_at: at(resets),
    }
}

#[test]
fn an_account_with_room_in_every_window_is_not_at_capacity() {
    let windows = [window("five_hour", 99.0, "2026-11-07T14:00:00")];

    assert_eq!(
        cause(false, false, &windows, at("2026-11-07T10:00:00")),
        None
    );
}

#[test]
fn a_full_window_blocks_until_it_resets_and_not_after() {
    let windows = [window("five_hour", 100.0, "2026-11-07T14:00:00")];

    assert!(cause(false, false, &windows, at("2026-11-07T13:59:59")).is_some());
    assert_eq!(
        cause(false, false, &windows, at("2026-11-07T14:00:00")),
        None
    );
}

#[test]
fn of_two_full_windows_the_cause_names_the_one_that_resets_last() {
    let windows = [
        window("five_hour", 100.0, "2026-11-07T14:00:00"),
        window("seven_day", 100.0, "2026-11-10T00:00:00"),
    ];

    assert_eq!(
        cause(false, false, &windows, at("2026-11-07T10:00:00")),
        Some(CapacityCause::UsageLimit {
            window: "seven_day".to_owned(),
            resets_at: "2026-11-10T00:00:00".to_owned(),
        })
    );
}

#[test]
fn a_manual_lock_on_the_agent_outranks_its_accounts_lock_and_usage() {
    let windows = [window("five_hour", 100.0, "2026-11-07T14:00:00")];
    let now = at("2026-11-07T10:00:00");

    assert_eq!(
        cause(true, true, &windows, now),
        Some(CapacityCause::AgentLocked)
    );
    assert_eq!(
        cause(false, true, &windows, now),
        Some(CapacityCause::AccountLocked)
    );
}

#[test]
fn a_lock_by_hand_does_not_lift_at_a_reset() {
    let windows = [window("five_hour", 100.0, "2026-11-07T14:00:00")];

    assert_eq!(
        cause(false, true, &windows, at("2026-11-08T00:00:00")),
        Some(CapacityCause::AccountLocked)
    );
}
