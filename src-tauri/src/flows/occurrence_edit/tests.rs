use chrono::NaiveDate;

use super::*;

fn scope(start_id: i64, end_id: i64) -> Option<TimeScope> {
    Some(TimeScope {
        start_id,
        end_id,
        duration: None,
    })
}

fn noon() -> NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 9, 20)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap()
}

#[test]
fn a_request_repeating_the_current_parent_and_window_is_not_a_move() {
    let parent = NodeId::Stored(7);
    let project = "project".to_string();
    assert!(refuse_moves((None, None), ("project", &parent), None, &scope(1, 1)).is_ok());
    assert!(refuse_moves(
        (Some(&project), Some(&NodeId::Stored(7))),
        ("project", &parent),
        Some(&scope(1, 1)),
        &scope(1, 1),
    )
    .is_ok());
}

#[test]
fn a_new_parent_is_refused() {
    let parent = NodeId::Stored(7);
    let project = "project".to_string();
    let goal = "goal".to_string();
    for request in [
        (Some(&project), Some(&NodeId::Stored(8))),
        (Some(&goal), Some(&NodeId::Stored(7))),
        (Some(&project), None),
    ] {
        let refused = refuse_moves(request, ("project", &parent), None, &None).unwrap_err();
        assert!(refused.to_string().contains("iteration"), "{refused}");
    }
}

#[test]
fn a_derived_parent_is_never_named_by_an_integer() {
    let parent = NodeId::Derived(crate::nodes::id::DerivedId::of_key(
        "flow_root:1:2026-09-20:0",
    ));
    let task = "task".to_string();
    assert!(refuse_moves(
        (Some(&task), Some(&NodeId::Stored(1))),
        ("task", &parent),
        None,
        &None
    )
    .is_err());
}

#[test]
fn a_new_window_is_refused_but_a_duration_tag_is_not_a_window() {
    let parent = NodeId::Stored(7);
    let refused = refuse_moves(
        (None, None),
        ("project", &parent),
        Some(&scope(1, 2)),
        &scope(1, 1),
    );
    assert!(refused.unwrap_err().to_string().contains("window"));
    let cleared = refuse_moves(
        (None, None),
        ("project", &parent),
        Some(&None),
        &scope(1, 1),
    );
    assert!(cleared.is_err());
    let mut tagged = scope(1, 1);
    if let Some(scope) = tagged.as_mut() {
        scope.duration = Some(crate::tasks::model::DurationSpec {
            n: 1,
            kind: "day".into(),
        });
    }
    assert!(refuse_moves(
        (None, None),
        ("project", &parent),
        Some(&tagged),
        &scope(1, 1)
    )
    .is_ok());
}

#[test]
fn completing_records_when_and_lifts_a_tombstone() {
    let mut overlay = TaskOverlay {
        tombstone: Some("archived".into()),
        ..TaskOverlay::default()
    };
    apply_task_status(&mut overlay, &TaskStatus::Done, noon());
    assert_eq!(overlay.status.as_deref(), Some("done"));
    assert_eq!(overlay.resolved_at, Some(resolved_at_ms(noon())));
    assert_eq!(overlay.tombstone, None);

    apply_task_status(&mut overlay, &TaskStatus::InProgress, noon());
    assert_eq!(overlay.status.as_deref(), Some("in_progress"));
    assert_eq!(overlay.resolved_at, None);

    apply_task_status(&mut overlay, &TaskStatus::Todo, noon());
    assert!(
        overlay.is_empty(),
        "To Do is the default, and leaves nothing behind"
    );
}

#[test]
fn a_completion_instant_reads_back_as_the_same_wall_clock() {
    let back = chrono::DateTime::from_timestamp_millis(resolved_at_ms(noon()))
        .unwrap()
        .naive_utc();
    assert_eq!(back, noon());
}

#[test]
fn a_retype_is_refused_out_loud() {
    assert!(refuse_retype().to_string().contains("cannot change kind"));
}

#[test]
fn an_iteration_root_defaults_to_its_iteration_ordinal() {
    assert_eq!(iteration_index(&Origin::Manual), 0);
}
