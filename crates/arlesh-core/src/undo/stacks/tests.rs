//! Unit tests for the two stacks.
//!
//! These are about the bookkeeping only — which Gesture is on top, and what a new one does to the
//! Redo Stack. That a Gesture taken off a stack actually reverses the board is
//! `tests/undo_engine.rs`'s job.

use super::*;
use crate::undo::model::{GestureId, GestureSummary, JournalEntry, RowImage, RowOperation};

fn gesture(name: &str, rows: usize) -> StackedGesture {
    let entries = (0..rows)
        .map(|index| JournalEntry {
            seq: i64::try_from(index).expect("small"),
            table: "tasks".into(),
            row_id: i64::try_from(index).expect("small"),
            operation: RowOperation::Insert,
            before: None,
            after: Some(RowImage::parse(r#"{"id":1}"#).expect("fixture image")),
        })
        .collect();
    StackedGesture::new(GestureId(name.into()), entries).expect("a gesture with rows")
}

fn named(summary: Option<GestureSummary>) -> Option<String> {
    summary.map(|summary| summary.gesture.0)
}

#[test]
fn a_gesture_that_changed_nothing_is_not_a_gesture_at_all() {
    assert!(
        StackedGesture::new(GestureId("empty".into()), Vec::new()).is_none(),
        "a press must never be spent on a step with no effect"
    );
}

#[test]
fn both_stacks_start_empty() {
    let stacks = UndoStacks::new();
    let status = stacks.status();

    assert_eq!(named(status.undo), None);
    assert_eq!(named(status.redo), None);
}

#[test]
fn taking_from_an_empty_stack_yields_nothing_rather_than_failing() {
    let stacks = UndoStacks::new();

    assert!(stacks.take(Stack::Undo).is_none());
    assert!(stacks.take(Stack::Redo).is_none());
}

#[test]
fn the_newest_recorded_gesture_is_the_one_undo_would_reverse() {
    let stacks = UndoStacks::new();
    stacks.record(gesture("older", 1));
    stacks.record(gesture("newer", 1));

    assert_eq!(named(stacks.status().undo), Some("newer".into()));
}

#[test]
fn a_new_gesture_clears_the_redo_stack() {
    let stacks = UndoStacks::new();
    stacks.put(Stack::Redo, gesture("undone", 1));
    assert_eq!(named(stacks.status().redo), Some("undone".into()));

    stacks.record(gesture("what the user did next", 1));

    assert_eq!(
        named(stacks.status().redo),
        None,
        "redo must never reapply onto a board that has moved on"
    );
}

#[test]
fn the_undo_stack_is_capped_and_drops_its_oldest_gesture_first() {
    let stacks = UndoStacks::new();
    for index in 0..MAX_JOURNALLED_GESTURES + 2 {
        stacks.record(gesture(&format!("gesture-{index}"), 1));
    }

    assert_eq!(
        named(stacks.status().undo),
        Some(format!("gesture-{}", MAX_JOURNALLED_GESTURES + 1)),
        "the newest survives"
    );
    let mut depth = 0;
    while stacks.take(Stack::Undo).is_some() {
        depth += 1;
    }
    assert_eq!(depth, MAX_JOURNALLED_GESTURES);
}

#[test]
fn a_gesture_moved_across_is_what_the_other_stack_now_offers() {
    let stacks = UndoStacks::new();
    stacks.record(gesture("reversed", 1));

    let taken = stacks.take(Stack::Undo).expect("something to undo");
    stacks.put(Stack::Undo.opposite(), taken);

    let status = stacks.status();
    assert_eq!(named(status.undo), None);
    assert_eq!(named(status.redo), Some("reversed".into()));
}

#[test]
fn the_two_stacks_replay_in_opposite_directions() {
    assert_eq!(Stack::Undo.direction(), Replay::Inverse);
    assert_eq!(Stack::Redo.direction(), Replay::Forward);
    assert_eq!(Stack::Redo.opposite(), Stack::Undo);
}

#[test]
fn a_summary_counts_the_rows_a_gesture_changed_and_names_the_tables() {
    let mut entries = gesture("mixed", 1).entries().to_vec();
    entries.push(JournalEntry {
        seq: 9,
        table: "tags_on_tasks".into(),
        row_id: 3,
        operation: RowOperation::Delete,
        before: Some(RowImage::parse(r#"{"task_id":1}"#).expect("fixture image")),
        after: None,
    });
    let summary = StackedGesture::new(GestureId("mixed".into()), entries)
        .expect("a gesture with rows")
        .summary();

    assert_eq!(summary.rows, 2);
    assert_eq!(summary.inserted, 1);
    assert_eq!(summary.deleted, 1);
    assert_eq!(summary.updated, 0);
    assert_eq!(summary.tables, ["tags_on_tasks", "tasks"]);
}
