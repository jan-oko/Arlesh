use super::*;
use crate::scopes::key::test_key;

fn at(iso: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn cooldown(n: i64, unit: CooldownUnit) -> Cooldown {
    Cooldown { n, unit }
}

/// Three Sunday-to-Saturday week windows from 2026-09-20, each `[Sun 02:00, next Sun 02:00)`.
fn three_weeks() -> Vec<SlotWindow> {
    (0..3)
        .map(|i| {
            let start = at("2026-09-20T02:00:00") + Duration::weeks(i);
            SlotWindow {
                index: i,
                scope_id: test_key(200 + i),
                start,
                end: start + Duration::weeks(1),
            }
        })
        .collect()
}

#[test]
fn a_one_day_cooldown_after_a_saturday_ends_on_monday_at_the_day_boundary() {
    let ends = cooldown(1, CooldownUnit::Day).ends(at("2026-09-26T19:00:00"));
    assert_eq!(ends, Some(at("2026-09-28T02:00:00")));
}

#[test]
fn a_completion_before_two_in_the_morning_counts_from_the_day_before() {
    // 01:30 on Sunday is still Saturday's Day, so the cooldown is Sunday and Monday opens.
    let ends = cooldown(1, CooldownUnit::Day).ends(at("2026-09-27T01:30:00"));
    assert_eq!(ends, Some(at("2026-09-28T02:00:00")));
}

#[test]
fn a_week_cooldown_counts_from_the_week_after_the_completion() {
    // Done Wednesday 2026-09-23 (week of the 20th): the week of the 27th is the cooldown.
    let ends = cooldown(1, CooldownUnit::Week).ends(at("2026-09-23T10:00:00"));
    assert_eq!(ends, Some(at("2026-10-04T02:00:00")));
}

#[test]
fn a_month_cooldown_counts_from_the_month_after_the_completion() {
    let ends = cooldown(2, CooldownUnit::Month).ends(at("2026-01-31T12:00:00"));
    assert_eq!(ends, Some(at("2026-04-01T02:00:00")));
}

#[test]
fn a_part_cooldown_skips_the_part_after_the_completion() {
    // Done in the Morning: Noon is the cooldown, the Afternoon opens.
    let ends = cooldown(1, CooldownUnit::Part).ends(at("2026-09-26T09:00:00"));
    assert_eq!(ends, Some(at("2026-09-26T15:00:00")));
}

#[test]
fn a_part_cooldown_runs_across_the_night_into_the_next_day() {
    // Done at 23:00, in the Night: the next Premorning is the cooldown, the Morning opens.
    let ends = cooldown(1, CooldownUnit::Part).ends(at("2026-09-26T23:00:00"));
    assert_eq!(ends, Some(at("2026-09-27T06:00:00")));
}

#[test]
fn a_weekly_habit_counts_its_cooldown_in_days_only() {
    assert_eq!(cooldown(2, CooldownUnit::Day).fits("week", 1), Ok(()));
    assert!(matches!(
        cooldown(1, CooldownUnit::Part).fits("week", 1),
        Err(CooldownRefusal::WrongUnit { .. })
    ));
    assert!(matches!(
        cooldown(1, CooldownUnit::Week).fits("week", 1),
        Err(CooldownRefusal::WrongUnit { .. })
    ));
}

#[test]
fn a_cooldown_as_long_as_the_window_is_refused() {
    assert_eq!(cooldown(6, CooldownUnit::Day).fits("week", 1), Ok(()));
    assert_eq!(
        cooldown(7, CooldownUnit::Day).fits("week", 1),
        Err(CooldownRefusal::TooLong)
    );
    assert_eq!(cooldown(5, CooldownUnit::Part).fits("day", 1), Ok(()));
    assert_eq!(
        cooldown(6, CooldownUnit::Part).fits("day", 1),
        Err(CooldownRefusal::TooLong)
    );
    assert_eq!(
        cooldown(28, CooldownUnit::Day).fits("month", 1),
        Err(CooldownRefusal::TooLong)
    );
    assert_eq!(cooldown(13, CooldownUnit::Day).fits("week", 2), Ok(()));
}

#[test]
fn a_week_cooldown_on_a_monthly_habit_leaves_room_for_the_straddling_week() {
    assert_eq!(cooldown(3, CooldownUnit::Week).fits("month", 1), Ok(()));
    assert_eq!(
        cooldown(4, CooldownUnit::Week).fits("month", 1),
        Err(CooldownRefusal::TooLong)
    );
}

#[test]
fn a_phase_window_takes_no_cooldown() {
    assert!(CooldownUnit::allowed_for("part").is_empty());
    assert!(CooldownUnit::allowed_for("exact").is_empty());
}

#[test]
fn parse_refuses_half_a_cooldown_and_a_zero() {
    assert_eq!(Cooldown::parse(None, None), Ok(None));
    assert_eq!(
        Cooldown::parse(Some(1), None),
        Err(CooldownRefusal::Unpaired)
    );
    assert_eq!(
        Cooldown::parse(Some(0), Some("day")),
        Err(CooldownRefusal::TooSmall)
    );
    assert_eq!(
        Cooldown::parse(Some(2), Some("day")),
        Ok(Some(cooldown(2, CooldownUnit::Day)))
    );
}

const DAY: Cooldown = Cooldown {
    n: 1,
    unit: CooldownUnit::Day,
};

#[test]
fn the_week_after_a_saturday_completion_is_held_through_sunday() {
    let slots = three_weeks();
    let resolved = HashMap::from([(0, at("2026-09-26T19:00:00"))]);
    let held = holds(&slots, &resolved, Some(&DAY), at("2026-09-27T10:00:00"));
    assert_eq!(held, HashMap::from([(1, at("2026-09-28T02:00:00"))]));
}

#[test]
fn the_hold_lifts_by_itself_when_the_cooldown_ends() {
    let slots = three_weeks();
    let resolved = HashMap::from([(0, at("2026-09-26T19:00:00"))]);
    assert!(holds(&slots, &resolved, Some(&DAY), at("2026-09-28T02:00:00")).is_empty());
}

#[test]
fn a_completion_made_after_the_next_window_opened_still_holds_it() {
    let slots = three_weeks();
    // Week 0 resolved late, on the Thursday of week 1: week 1 is blocked until Saturday.
    let resolved = HashMap::from([(0, at("2026-10-01T10:00:00"))]);
    let held = holds(&slots, &resolved, Some(&DAY), at("2026-10-01T11:00:00"));
    assert_eq!(held, HashMap::from([(1, at("2026-10-03T02:00:00"))]));
}

#[test]
fn a_hold_reaches_only_the_iteration_right_after() {
    let slots = three_weeks();
    let resolved = HashMap::from([(0, at("2026-09-26T19:00:00"))]);
    let held = holds(&slots, &resolved, Some(&DAY), at("2026-09-27T10:00:00"));
    assert!(!held.contains_key(&2));
}

#[test]
fn a_resolved_iteration_is_held_by_nothing() {
    let slots = three_weeks();
    let resolved = HashMap::from([
        (0, at("2026-09-26T19:00:00")),
        (1, at("2026-09-27T12:00:00")),
    ]);
    let held = holds(&slots, &resolved, Some(&DAY), at("2026-09-27T13:00:00"));
    assert!(!held.contains_key(&1), "done by hand inside its cooldown");
    assert_eq!(
        held.get(&2),
        Some(&at("2026-09-29T02:00:00")),
        "and that completion holds the next one in turn"
    );
}

#[test]
fn no_cooldown_holds_nothing() {
    let slots = three_weeks();
    let resolved = HashMap::from([(0, at("2026-09-26T19:00:00"))]);
    assert!(holds(&slots, &resolved, None, at("2026-09-27T10:00:00")).is_empty());
}
