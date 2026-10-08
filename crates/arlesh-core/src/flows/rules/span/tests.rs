use super::*;
use crate::flows::TemplateFields;
use crate::scopes::key::ScopeKey;
use chrono::{NaiveDate, NaiveDateTime};

fn date(iso: &str) -> NaiveDate {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").unwrap_or_default()
}

fn at(iso: &str) -> NaiveDateTime {
    date(iso).and_hms_opt(2, 0, 0).unwrap_or_default()
}

fn weekly() -> Flow {
    Flow {
        id: 1,
        title: "Weekly review".into(),
        instance_type: "task".into(),
        parent_type: "project".into(),
        parent_id: 2,
        target_type: None,
        target_id: None,
        flow_duration_n: Some(1),
        flow_duration_kind: Some("week".into()),
        flow_window_part: None,
        flow_window_time_start: None,
        flow_window_time_end: None,
        root_plan_kind: None,
        root_plan_start: None,
        root_plan_end: None,
        verdict_window_n: None,
        verdict_window_kind: None,
        is_habit: true,
        position: 0,
        is_private: false,
        template: TemplateFields::default(),
    }
}

fn recurrence(end: Option<&str>) -> FlowRecurrence {
    FlowRecurrence {
        flow_id: 1,
        start_scope_id: ScopeKey::Week {
            date: date("2026-10-04"),
        },
        gap_n: None,
        gap_kind: None,
        end_scope_id: end.map(|end| ScopeKey::Week { date: date(end) }),
        clock: "window".into(),
        miss_policy: Some("archive".into()),
        cooldown_n: None,
        cooldown_kind: None,
    }
}

#[test]
fn a_bounded_habit_spans_its_first_window_to_its_last() {
    let span = habit_span(&weekly(), &recurrence(Some("2026-10-18"))).unwrap();
    assert_eq!(
        span.time_scope,
        Some(Span {
            start: at("2026-10-04"),
            end: Some(at("2026-10-25")),
        })
    );
    assert_eq!(span.plan, None);
}

#[test]
fn an_endless_habit_runs_on_without_end() {
    let span = habit_span(&weekly(), &recurrence(None)).unwrap();
    assert_eq!(span.time_scope.and_then(|span| span.end), None);
}

#[test]
fn a_planned_root_spans_its_first_plan_to_its_last() {
    let flow = Flow {
        root_plan_kind: Some("day".into()),
        root_plan_start: Some(2),
        root_plan_end: Some(2),
        ..weekly()
    };
    let span = habit_span(&flow, &recurrence(Some("2026-10-18"))).unwrap();
    assert_eq!(
        span.plan,
        Some(Span {
            start: at("2026-10-05"),
            end: Some(at("2026-10-20")),
        })
    );
}

#[test]
fn an_unscoped_habit_spans_nothing() {
    let flow = Flow {
        flow_duration_n: None,
        flow_duration_kind: None,
        ..weekly()
    };
    assert_eq!(
        habit_span(&flow, &recurrence(None)).unwrap(),
        HabitSpan::default()
    );
}
