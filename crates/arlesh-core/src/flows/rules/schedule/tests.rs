use super::*;

fn day(month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, month, day).unwrap()
}

fn at(month: u32, on: u32, hour: u32) -> NaiveDateTime {
    day(month, on).and_hms_opt(hour, 0, 0).unwrap()
}

fn weeks(n: i64) -> WindowSpec {
    WindowSpec::Span {
        n,
        kind: ScopeKind::Week,
        kind_str: "week".to_string(),
    }
}

/// The first day of each slot's window.
fn starts(slots: &[SlotWindow]) -> Vec<NaiveDate> {
    slots.iter().map(|slot| slot.start.date()).collect()
}

/// Weeks run Sunday to Saturday: W1 of this test is the week of Sunday 2026-01-04.
const W1: (u32, u32) = (1, 4);

fn week(n: u32) -> NaiveDate {
    day(W1.0, W1.1) + Duration::weeks(i64::from(n) - 1)
}

#[test]
fn an_interval_window_starts_the_unit_after_the_completion() {
    // The user's own example (2026-09-30): a two-week window W1–2 completed in W3 gives W4–5.
    let completed = [week(3) + Duration::days(2)];
    let mut done = completed.iter();
    let slots = interval_slots(week(1), Some(&weeks(2)), None, None, at(3, 1, 12), |_| {
        done.next().map(|date| date.and_hms_opt(10, 0, 0).unwrap())
    })
    .unwrap();
    assert_eq!(starts(&slots), vec![week(1), week(4)]);
    assert_eq!(slots[1].end.date(), week(6));
}

#[test]
fn an_interval_completed_early_starts_the_next_window_inside_the_last() {
    // Completed in W1 gives W2–3.
    let mut done = [week(1) + Duration::days(1)].into_iter();
    let slots = interval_slots(week(1), Some(&weeks(2)), None, None, at(3, 1, 12), |_| {
        done.next().map(|date| date.and_hms_opt(10, 0, 0).unwrap())
    })
    .unwrap();
    assert_eq!(starts(&slots), vec![week(1), week(2)]);
}

#[test]
fn an_interval_gap_rests_between_the_completion_unit_and_the_next_window() {
    // Weekly, a one-week Gap, completed in W1: W2 rests, W3 is next.
    let mut done = [week(1) + Duration::days(3)].into_iter();
    let slots = interval_slots(
        week(1),
        Some(&weeks(1)),
        Some(&(1, "week".to_string())),
        None,
        at(3, 1, 12),
        |_| done.next().map(|date| date.and_hms_opt(10, 0, 0).unwrap()),
    )
    .unwrap();
    assert_eq!(starts(&slots), vec![week(1), week(3)]);
}

#[test]
fn an_interval_chain_stops_at_its_one_open_instance() {
    let slots =
        interval_slots(week(1), Some(&weeks(1)), None, None, at(3, 1, 12), |_| None).unwrap();
    assert_eq!(starts(&slots), vec![week(1)]);
}

#[test]
fn an_interval_instance_completed_before_its_window_opened_still_moves_the_habit_on() {
    // The second instance (W3) is completed during W2, before it opened: the next is W4, not W3
    // again.
    let completions = [week(1) + Duration::days(8), week(2) + Duration::days(2)];
    let mut done = completions.iter();
    let slots = interval_slots(week(1), Some(&weeks(1)), None, None, at(3, 1, 12), |_| {
        done.next().map(|date| date.and_hms_opt(10, 0, 0).unwrap())
    })
    .unwrap();
    assert_eq!(starts(&slots), vec![week(1), week(3), week(4)]);
}

#[test]
fn an_interval_reads_a_completion_after_midnight_as_the_day_before() {
    // Daily; completed at 01:00 on the 6th, which is still the 5th: the next is the 6th.
    let spec = WindowSpec::Span {
        n: 1,
        kind: ScopeKind::Day,
        kind_str: "day".to_string(),
    };
    let mut done = [at(1, 6, 1)].into_iter();
    let slots = interval_slots(day(1, 5), Some(&spec), None, None, at(1, 9, 12), |_| {
        done.next()
    })
    .unwrap();
    assert_eq!(starts(&slots), vec![day(1, 5), day(1, 6)]);
}

#[test]
fn an_interval_stops_at_its_end() {
    let mut done = [week(1) + Duration::days(1)].into_iter();
    let slots = interval_slots(
        week(1),
        Some(&weeks(1)),
        None,
        Some(week(1)),
        at(3, 1, 12),
        |_| done.next().map(|date| date.and_hms_opt(10, 0, 0).unwrap()),
    )
    .unwrap();
    assert_eq!(starts(&slots), vec![week(1)]);
}

#[test]
fn an_unscoped_interval_with_no_gap_appears_again_the_moment_it_is_completed() {
    let completed = at(1, 5, 15);
    let mut done = [completed].into_iter();
    let slots = interval_slots(day(1, 5), None, None, None, at(1, 9, 12), |_| done.next()).unwrap();
    assert_eq!(slots.len(), 2);
    assert_eq!(slots[0].start, at(1, 5, 2));
    assert_eq!(slots[1].start, completed);
    assert_eq!(slots[1].end, habits::UNBOUNDED);
    assert_ne!(slots[0].scope_id, slots[1].scope_id);
}

#[test]
fn an_unscoped_interval_appears_the_gap_after_the_day_it_was_completed() {
    // "Every three days", completed on a Monday afternoon, appears on the Thursday.
    let mut done = [at(1, 5, 15)].into_iter();
    let slots = interval_slots(
        day(1, 5),
        None,
        Some(&(3, "day".to_string())),
        None,
        at(1, 20, 12),
        |_| done.next(),
    )
    .unwrap();
    assert_eq!(slots[1].start, at(1, 8, 2));
}

#[test]
fn an_unscoped_interval_completed_twice_in_one_second_still_keys_two_instances() {
    let completed = at(1, 5, 2);
    let mut done = [completed, completed].into_iter();
    let slots = interval_slots(day(1, 5), None, None, None, at(1, 9, 12), |_| done.next()).unwrap();
    let keys: std::collections::HashSet<ScopeKey> =
        slots.iter().map(|slot| slot.scope_id).collect();
    assert_eq!(keys.len(), slots.len());
}
