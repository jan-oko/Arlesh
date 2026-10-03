use chrono::NaiveDate;

use super::*;
use crate::nodes::{
    key::{TemplateItem, TemplateKind},
    overlay::{GoalOverlay, TaskOverlay},
};
use crate::scopes::key::ScopeKey;

fn key(item_id: i64) -> OccurrenceKey {
    OccurrenceKey {
        item: TemplateItem {
            item_type: TemplateKind::FlowTask,
            item_id,
        },
        iteration: ScopeKey::day(NaiveDate::from_ymd_opt(2026, 1, 5).unwrap()),
        cycle: 0,
    }
}

fn at(hour: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 1, 5)
        .unwrap()
        .and_hms_opt(hour, 0, 0)
        .unwrap()
}

#[test]
fn an_occurrences_instant_is_its_overlays_resolved_at() {
    let mut overlays = HabitOverlays::default();
    overlays.tasks.insert(
        key(1).node_key(),
        TaskOverlay {
            resolved_at: Some(at(9).and_utc().timestamp_millis()),
            ..TaskOverlay::default()
        },
    );
    overlays.goals.insert(
        key(2).node_key(),
        GoalOverlay {
            resolved_at: Some(at(10).and_utc().timestamp_millis()),
            ..GoalOverlay::default()
        },
    );
    overlays
        .tasks
        .insert(key(3).node_key(), TaskOverlay::default());

    let instants = occurrence_instants(&overlays);

    assert_eq!(instants.get(&NodeId::Derived(key(1).id())), Some(&at(9)));
    assert_eq!(instants.get(&NodeId::Derived(key(2).id())), Some(&at(10)));
    assert!(
        !instants.contains_key(&NodeId::Derived(key(3).id())),
        "nothing recorded, no instant"
    );
}

#[test]
fn a_checks_instant_is_keyed_by_its_check_task() {
    let row = CheckRow {
        wait_kind: "stored".into(),
        wait_id: Some(4),
        wait_key: None,
        due_at: "2026-01-05T09:00:00".into(),
        resolved_at: "2026-01-05T11:00:00".into(),
    };
    let expected = DerivedKey::Check(CheckKey {
        wait: WaitRef::Stored(4),
        due_at: at(9),
    })
    .node_id();
    assert_eq!(row.instant(), Some((expected, at(11))));

    let malformed = CheckRow {
        wait_kind: "occurrence".into(),
        wait_id: None,
        wait_key: None,
        due_at: "2026-01-05T09:00:00".into(),
        resolved_at: "2026-01-05T11:00:00".into(),
    };
    assert_eq!(malformed.instant(), None);
}
