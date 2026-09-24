use super::*;
use crate::scopes::key::ScopeKey;

fn habit() -> Origin {
    Origin::Habit(HabitOrigin {
        habit_id: 3,
        iteration_scope: IterationScope {
            index: 2,
            start_date: NaiveDate::from_ymd_opt(2026, 9, 20).unwrap(),
            window_end: NaiveDate::from_ymd_opt(2026, 9, 21)
                .unwrap()
                .and_hms_opt(2, 0, 0)
                .unwrap(),
            scope_id: ScopeKey::day(NaiveDate::from_ymd_opt(2026, 9, 20).unwrap()),
            kind: Some("day".to_string()),
            status: IterationStatus::Active,
        },
        item_type: TemplateKind::FlowRoot,
        item_id: 3,
        cycle_id: 0,
    })
}

#[test]
fn a_manual_origin_travels_as_its_kind_alone() {
    assert_eq!(
        serde_json::to_value(Origin::Manual).unwrap(),
        serde_json::json!({ "kind": "manual" })
    );
    assert!(!Origin::default().is_derived());
    assert!(Origin::Manual.habit().is_none());
}

#[test]
fn a_habit_origin_names_its_habit_and_iteration() {
    let origin = habit();
    let json = serde_json::to_value(&origin).unwrap();
    assert_eq!(json["kind"], "habit");
    assert_eq!(json["habit_id"], 3);
    assert_eq!(json["item_type"], "flow_root");
    assert_eq!(json["iteration_scope"]["start_date"], "2026-09-20");
    assert_eq!(json["iteration_scope"]["window_end"], "2026-09-21T02:00:00");
    assert_eq!(json["iteration_scope"]["status"], "active");
    assert_eq!(
        json["iteration_scope"]["scope_id"],
        serde_json::json!({"kind": "day", "date": "2026-09-20"})
    );
    assert_eq!(serde_json::from_value::<Origin>(json).unwrap(), origin);
    assert!(origin.is_derived());
    assert!(origin.habit().is_some_and(HabitOrigin::is_root));
}
