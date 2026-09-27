use super::*;
use chrono::NaiveDate;

/// A window spanning `[from, to)` in July 2026, by day-of-month. Pure test data: nothing
/// here resolves a scope, because [`check_containment`] never does.
fn july(from: u32, to: u32) -> Bounds {
    let at = |day| {
        NaiveDate::from_ymd_opt(2026, 7, day)
            .expect("July has this day")
            .and_hms_opt(0, 0, 0)
            .expect("midnight is a time")
    };
    (at(from), at(to))
}

/// The `ScopeContainment` message, or a panic naming what came back instead.
fn violation(result: Result<(), TaskError>) -> String {
    match result {
        Err(TaskError::ScopeContainment(message)) => message,
        other => panic!("expected a containment violation, got {other:?}"),
    }
}

#[test]
fn a_task_nested_inside_every_window_above_it_is_accepted() {
    let windows = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        plan: Some(july(12, 14)),
        ancestor_scope: Some(july(1, 31)),
        ancestor_plan: Some(july(11, 15)),
        overdue: false,
    };

    assert!(check_containment(windows).is_ok());
}

#[test]
fn a_plan_escaping_its_own_time_scope_is_rejected() {
    let windows = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        plan: Some(july(18, 25)),
        ..Default::default()
    };

    assert_eq!(
        violation(check_containment(windows)),
        "plan is not within the task's time scope"
    );
}

#[test]
fn a_time_scope_escaping_the_nearest_scoped_ancestor_is_rejected() {
    let windows = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        ancestor_scope: Some(july(12, 18)),
        ..Default::default()
    };

    assert_eq!(
        violation(check_containment(windows)),
        "time scope is not within the parent's time scope"
    );
}

#[test]
fn a_plan_escaping_the_nearest_planned_ancestor_is_rejected() {
    let windows = ContainmentWindows {
        plan: Some(july(10, 20)),
        ancestor_plan: Some(july(12, 18)),
        ..Default::default()
    };

    assert_eq!(
        violation(check_containment(windows)),
        "plan is not within the parent task's plan"
    );
}

#[test]
fn the_first_violation_is_the_only_one_reported() {
    // Every rule is broken at once. Collecting all three is a deliberate non-goal, so the
    // message must be rule one's and the check must stop there.
    let windows = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        plan: Some(july(1, 31)),
        ancestor_scope: Some(july(12, 18)),
        ancestor_plan: Some(july(13, 14)),
        overdue: false,
    };

    assert_eq!(
        violation(check_containment(windows)),
        "plan is not within the task's time scope"
    );
}

#[test]
fn a_rule_whose_windows_are_not_both_present_is_skipped() {
    // Unconstrained above and unplanned: only rule one has both its inputs, and it holds.
    let unconstrained = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        plan: Some(july(12, 14)),
        ..Default::default()
    };
    assert!(check_containment(unconstrained).is_ok());

    // A plan escaping every window above it, on an item that has no plan of its own: two
    // rules go quiet rather than firing on a window that is not there.
    let unplanned = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        ancestor_scope: Some(july(1, 31)),
        ancestor_plan: Some(july(13, 14)),
        ..Default::default()
    };
    assert!(check_containment(unplanned).is_ok());
}

#[test]
fn a_goal_shaped_check_reduces_to_the_ancestor_rule_alone() {
    // A goal has no Plan, so `plan` and `ancestor_plan` are structurally absent and rules
    // one and three cannot fire. That is the whole of `validate_goal_containment`.
    let inside = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        ancestor_scope: Some(july(1, 31)),
        ..Default::default()
    };
    assert!(check_containment(inside).is_ok());

    let outside = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        ancestor_scope: Some(july(12, 18)),
        ..Default::default()
    };
    assert_eq!(
        violation(check_containment(outside)),
        "time scope is not within the parent's time scope"
    );
}

/// An instant in July 2026, by day-of-month, for the Overdue derivation.
fn july_day(day: u32) -> NaiveDateTime {
    july(day, day).0
}

/// A Time Scope of one real Day in July 2026 — the one thing here that resolves, because
/// [`is_overdue`] reads a stored window rather than a bound.
fn july_day_scope(day: u32) -> TimeScope {
    let key = crate::scopes::key::ScopeKey::containing(
        crate::scopes::model::ScopeKind::Day,
        NaiveDate::from_ymd_opt(2026, 7, day).expect("July has this day"),
    )
    .expect("a Day scope contains any date");
    TimeScope {
        start_id: key,
        end_id: key,
        duration: None,
    }
}

#[test]
fn an_overdue_task_may_plan_outside_its_own_time_scope() {
    // Its window was the 10th–20th and has passed; it is planned into the 25th–26th.
    let windows = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        plan: Some(july(25, 26)),
        overdue: true,
        ..Default::default()
    };

    assert!(check_containment(windows).is_ok());
}

#[test]
fn an_overdue_task_is_still_held_by_its_nearest_planned_ancestor() {
    let windows = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        plan: Some(july(25, 26)),
        ancestor_plan: Some(july(21, 24)),
        overdue: true,
        ..Default::default()
    };

    assert_eq!(
        violation(check_containment(windows)),
        "plan is not within the parent task's plan"
    );
}

#[test]
fn an_overdue_task_is_still_held_by_its_nearest_scoped_ancestor() {
    // The exemption is for the Plan alone: the task's own window stays inside its parent's.
    let windows = ContainmentWindows {
        own_scope: Some(july(10, 20)),
        ancestor_scope: Some(july(12, 18)),
        overdue: true,
        ..Default::default()
    };

    assert_eq!(
        violation(check_containment(windows)),
        "time scope is not within the parent's time scope"
    );
}

#[test]
fn a_lapsed_unfinished_keep_on_exit_task_is_overdue() {
    let scope = Some(july_day_scope(10));

    assert!(is_overdue(
        &scope,
        Some(OnScopeExit::Keep),
        false,
        july_day(20)
    ));
}

#[test]
fn a_task_whose_window_has_not_passed_is_not_overdue() {
    let scope = Some(july_day_scope(10));

    assert!(!is_overdue(
        &scope,
        Some(OnScopeExit::Keep),
        false,
        july_day(5)
    ));
}

#[test]
fn a_done_task_is_not_overdue() {
    let scope = Some(july_day_scope(10));

    assert!(!is_overdue(
        &scope,
        Some(OnScopeExit::Keep),
        true,
        july_day(20)
    ));
}

#[test]
fn a_missed_task_is_not_overdue() {
    // Archive-on-exit: its lapse reads Missed and archives it, so it is not rescheduled.
    let scope = Some(july_day_scope(10));

    assert!(!is_overdue(
        &scope,
        Some(OnScopeExit::Archive),
        false,
        july_day(20)
    ));
}

#[test]
fn a_task_with_no_time_scope_of_its_own_is_not_overdue() {
    assert!(!is_overdue(
        &None,
        Some(OnScopeExit::Keep),
        false,
        july_day(20)
    ));
}

/// A pending, live wait under `(parent_type, parent_id)`, with `time_scope` as its own window.
fn wait_under(
    id: i64,
    parent_type: &str,
    parent_id: i64,
    time_scope: Option<TimeScope>,
) -> Expectation {
    Expectation {
        id: NodeId::Stored(id),
        title: "wait".to_string(),
        parent_type: parent_type.to_string(),
        parent_id: NodeId::Stored(parent_id),
        status: ExpectationStatus::Pending,
        archival: ExpectationArchival::Live,
        time_scope,
        tag_ids: Vec::new(),
        check_every: None,
        check_starting: None,
        last_check_at: None,
        position: 0,
        is_private: false,
        agentic: false,
        agentic_note: None,
        question: false,
        answer: None,
        origin: Default::default(),
    }
}

/// A lifecycle entry reading `timing`, for `node_type`/`id`.
fn entry(node_type: &str, id: i64, timing: Timing) -> ItemLifecycle {
    ItemLifecycle {
        node_type: node_type.to_string(),
        node_id: NodeId::Stored(id),
        timing,
        resolution: None,
        verdict: None,
        archival: Archival::Live,
        archival_conflict: false,
        plan_timing: None,
    }
}

fn timing_of(lifecycles: &[ItemLifecycle], id: i64) -> Option<Timing> {
    lifecycles
        .iter()
        .find(|entry| entry.node_type == EXPECTATION && entry.node_id == NodeId::Stored(id))
        .map(|entry| entry.timing)
}

#[test]
fn an_unscoped_wait_under_a_task_whose_window_is_ahead_reads_pending() {
    let waits = [wait_under(1, "task", 10, None)];
    let mut lifecycles = vec![
        entry("task", 10, Timing::Pending),
        entry(EXPECTATION, 1, Timing::Active),
    ];

    mark_waits_under_pending(&waits, &mut lifecycles);

    assert_eq!(timing_of(&lifecycles, 1), Some(Timing::Pending));
}

#[test]
fn a_wait_that_sent_no_entry_gets_a_pending_one_under_a_pending_parent() {
    let waits = [wait_under(2, "goal", 20, None)];
    let mut lifecycles = vec![entry("goal", 20, Timing::Pending)];

    mark_waits_under_pending(&waits, &mut lifecycles);

    assert_eq!(timing_of(&lifecycles, 2), Some(Timing::Pending));
}

#[test]
fn an_unscoped_wait_under_a_lapsed_task_keeps_its_own_timing() {
    let waits = [wait_under(3, "task", 30, None)];
    let mut lifecycles = vec![
        entry("task", 30, Timing::Lapsed),
        entry(EXPECTATION, 3, Timing::Active),
    ];

    mark_waits_under_pending(&waits, &mut lifecycles);

    assert_eq!(timing_of(&lifecycles, 3), Some(Timing::Active));
}

#[test]
fn a_wait_with_a_window_of_its_own_answers_to_it_alone() {
    let waits = [wait_under(4, "task", 40, Some(july_day_scope(12)))];
    let mut lifecycles = vec![
        entry("task", 40, Timing::Pending),
        entry(EXPECTATION, 4, Timing::Active),
    ];

    mark_waits_under_pending(&waits, &mut lifecycles);

    assert_eq!(timing_of(&lifecycles, 4), Some(Timing::Active));
}
