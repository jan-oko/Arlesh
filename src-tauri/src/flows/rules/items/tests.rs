use chrono::NaiveDate;

use super::*;

fn at(date: &str, hour: u32) -> NaiveDateTime {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .unwrap()
        .and_hms_opt(hour, 0, 0)
        .unwrap()
}

fn first(kind: &str, index: i64) -> FirstCheck {
    FirstCheck {
        kind: kind.to_string(),
        index,
    }
}

#[test]
fn with_no_first_check_a_wait_is_first_checked_when_its_window_opens() {
    let start = at("2026-10-04", 2);
    assert_eq!(first_check_at(start, None).unwrap(), start);
}

#[test]
fn the_third_day_of_a_weekly_window_is_two_days_after_it_opens() {
    // The week of Sunday 4 October opens at 02:00 that day.
    let checked = first_check_at(at("2026-10-04", 2), Some(&first("day", 3))).unwrap();
    assert_eq!(checked, at("2026-10-06", 2));
}

#[test]
fn parts_are_counted_from_the_part_the_window_opens_in() {
    let opens = at("2026-10-04", 2);
    assert_eq!(
        first_check_at(opens, Some(&first("part_of_day", 1))).unwrap(),
        opens
    );
    assert_eq!(
        first_check_at(opens, Some(&first("part_of_day", 3))).unwrap(),
        at("2026-10-04", 12),
        "Premorning, Morning, then Noon"
    );
    assert_eq!(
        first_check_at(at("2026-10-04", 12), Some(&first("part_of_day", 6))).unwrap(),
        at("2026-10-05", 6),
        "from Noon: Noon, Afternoon, Evening, Night, Premorning, Morning"
    );
}

#[test]
fn a_unit_the_window_opens_part_way_through_counts_from_the_window() {
    // A week opening on Sunday 4 October is part-way through October.
    let opens = at("2026-10-04", 2);
    assert_eq!(
        first_check_at(opens, Some(&first("month", 1))).unwrap(),
        opens
    );
}

#[test]
fn a_first_check_names_a_countable_unit_from_one() {
    assert!(require_first_check(&first("hour", 1)).is_err());
    assert!(require_first_check(&first("day", 0)).is_err());
    assert!(require_first_check(&first("week", 2)).is_ok());
}

#[test]
fn items_sit_where_the_stored_kinds_they_draw_do() {
    use FlowItemType::*;
    assert!(may_hold(FlowExpectation, "flow_goal", "goal"));
    assert!(may_hold(FlowCommitment, "flow_commitment", "task"));
    assert!(may_hold(FlowTask, "flow_commitment", "task"));
    assert!(!may_hold(FlowGoal, "flow_commitment", "task"));
    assert!(!may_hold(FlowGoal, "flow", "commitment"));
    assert!(may_hold(FlowCommitment, "flow", "commitment"));
    assert!(!may_hold(FlowTask, "flow_expectation", "task"));
    assert!(!may_hold(FlowTask, "project", "task"));
}

#[test]
fn only_a_task_waits_and_never_on_a_commitment() {
    use FlowItemType::*;
    assert!(may_depend(FlowTask, FlowExpectation));
    assert!(may_depend(FlowTask, FlowGoal));
    assert!(!may_depend(FlowTask, FlowCommitment));
    assert!(!may_depend(FlowExpectation, FlowTask));
    assert!(!may_depend(FlowCommitment, FlowTask));
}
