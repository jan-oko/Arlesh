//! Unit tests for turning a journal entry into the statement that applies it.
//!
//! Pure: no database, no connection. What these pin is the *shape* of the SQL — that a restored
//! row names its original rowid, that an overwrite names every column rather than the ones that
//! changed, and that an identifier the engine would have to interpolate is refused. Whether the
//! statements actually put a board back is `tests/undo_engine.rs`'s job.

use super::*;
use crate::undo::model::{JournalEntry, RowImage, RowOperation};

fn image(json: &str) -> RowImage {
    RowImage::parse(json).expect("the fixture image must parse")
}

fn entry(operation: RowOperation, before: Option<&str>, after: Option<&str>) -> JournalEntry {
    JournalEntry {
        seq: 7,
        table: "tasks".into(),
        row_id: 42,
        operation,
        before: before.map(image),
        after: after.map(image),
    }
}

fn only(entries: &[JournalEntry], direction: Replay) -> Statement {
    let mut statements = plan(entries, direction).expect("the plan must build");
    assert_eq!(statements.len(), 1, "one entry makes one statement");
    statements.remove(0)
}

#[test]
fn undoing_an_insert_deletes_the_row_it_created_by_its_rowid() {
    let entries = vec![entry(RowOperation::Insert, None, Some(r#"{"id":42}"#))];
    let statement = only(&entries, Replay::Inverse);

    assert_eq!(statement.sql(), "DELETE FROM \"tasks\" WHERE rowid = ?");
    assert_eq!(statement.values(), [SqlValue::Integer(42)]);
}

#[test]
fn redoing_a_delete_deletes_the_row_again() {
    let entries = vec![entry(RowOperation::Delete, Some(r#"{"id":42}"#), None)];
    let statement = only(&entries, Replay::Forward);

    assert_eq!(statement.sql(), "DELETE FROM \"tasks\" WHERE rowid = ?");
}

#[test]
fn undoing_a_delete_reinserts_the_row_at_its_original_rowid() {
    let entries = vec![entry(
        RowOperation::Delete,
        Some(r#"{"id":42,"title":"kept","parent_id":null}"#),
        None,
    )];
    let statement = only(&entries, Replay::Inverse);

    assert_eq!(
        statement.sql(),
        "INSERT INTO \"tasks\" (rowid, \"id\", \"parent_id\", \"title\") \
         VALUES (?, ?, ?, ?)",
        "the rowid is named first and the columns follow in name order"
    );
    assert_eq!(
        statement.values(),
        [
            SqlValue::Integer(42),
            SqlValue::Integer(42),
            SqlValue::Null,
            SqlValue::Text("kept".into()),
        ],
        "a NULL column is restored as NULL, not left at whatever the row has now"
    );
}

#[test]
fn a_restored_row_of_a_table_with_its_own_rowid_column_does_not_name_rowid_twice() {
    let mut entries = vec![entry(RowOperation::Delete, Some(r#"{"rowid":9}"#), None)];
    entries[0].table = "task_dependencies".into();
    let statement = only(&entries, Replay::Inverse);

    assert_eq!(
        statement.sql(),
        "INSERT INTO \"task_dependencies\" (\"rowid\") VALUES (?)",
        "naming rowid twice is a syntax error, so the image's own column wins"
    );
    assert_eq!(statement.values(), [SqlValue::Integer(9)]);
}

#[test]
fn undoing_an_update_writes_every_column_of_the_before_image_back() {
    let entries = vec![entry(
        RowOperation::Update,
        Some(r#"{"id":42,"status":"todo","weight":1.5}"#),
        Some(r#"{"id":42,"status":"done","weight":1.5}"#),
    )];
    let statement = only(&entries, Replay::Inverse);

    assert_eq!(
        statement.sql(),
        "UPDATE \"tasks\" SET \"id\" = ?, \"status\" = ?, \"weight\" = ? WHERE rowid = ?",
        "every column, not the ones that differ: a column left out is a field silently lost"
    );
    assert_eq!(
        statement.values(),
        [
            SqlValue::Integer(42),
            SqlValue::Text("todo".into()),
            SqlValue::Real(1.5),
            SqlValue::Integer(42),
        ]
    );
}

#[test]
fn redoing_an_update_writes_the_after_image_back() {
    let entries = vec![entry(
        RowOperation::Update,
        Some(r#"{"status":"todo"}"#),
        Some(r#"{"status":"done"}"#),
    )];
    let statement = only(&entries, Replay::Forward);

    assert_eq!(statement.values()[0], SqlValue::Text("done".into()));
}

#[test]
fn an_undo_applies_a_gestures_entries_newest_first_and_a_redo_oldest_first() {
    let mut first = entry(RowOperation::Insert, None, Some(r#"{"id":1}"#));
    first.seq = 1;
    first.row_id = 1;
    let mut second = entry(RowOperation::Insert, None, Some(r#"{"id":2}"#));
    second.seq = 2;
    second.row_id = 2;
    let entries = vec![first, second];

    let inverse = plan(&entries, Replay::Inverse).expect("plan");
    assert_eq!(
        inverse[0].values(),
        [SqlValue::Integer(2)],
        "undo takes the last change back first"
    );

    let forward = plan(&entries, Replay::Forward).expect("plan");
    assert_eq!(
        forward[0].values()[0],
        SqlValue::Integer(1),
        "redo replays them in the order they happened, reinserting the first row first"
    );
}

#[test]
fn a_boolean_in_an_image_is_restored_as_the_integer_sqlite_stores() {
    let entries = vec![entry(RowOperation::Delete, Some(r#"{"done":true}"#), None)];
    let statement = only(&entries, Replay::Inverse);

    assert_eq!(statement.values()[1], SqlValue::Integer(1));
}

#[test]
fn an_entry_missing_the_image_its_operation_needs_is_refused() {
    let entries = vec![entry(RowOperation::Delete, None, None)];
    let error = plan(&entries, Replay::Inverse).expect_err("must not build a statement");

    assert!(
        matches!(&error, UndoError::MalformedEntry { seq, table, .. } if *seq == 7 && table == "tasks"),
        "the entry that cannot be applied must be named, got {error}"
    );
}

#[test]
fn an_entry_whose_image_names_no_columns_is_refused() {
    let entries = vec![entry(RowOperation::Delete, Some("{}"), None)];
    let error = plan(&entries, Replay::Inverse).expect_err("must not build a statement");

    assert!(
        matches!(&error, UndoError::MalformedEntry { reason, .. } if reason.contains("no columns")),
        "a row restored with no columns is worse than one not restored, got {error}"
    );
}

#[test]
fn a_nested_value_in_an_image_is_refused_rather_than_restored_as_text() {
    let entries = vec![entry(RowOperation::Delete, Some(r#"{"plan":[1,2]}"#), None)];
    let error = plan(&entries, Replay::Inverse).expect_err("must not build a statement");

    assert!(
        matches!(&error, UndoError::MalformedImage(reason) if reason.contains("plan")),
        "expected the offending column to be named, got {error}"
    );
}

#[test]
fn a_table_name_that_is_not_a_plain_identifier_is_refused() {
    let mut entries = vec![entry(RowOperation::Insert, None, Some(r#"{"id":1}"#))];
    entries[0].table = "tasks\"; DROP TABLE tasks --".into();
    let error = plan(&entries, Replay::Inverse).expect_err("must not build a statement");

    assert!(
        matches!(&error, UndoError::UnsafeIdentifier(name) if name.starts_with("tasks\"")),
        "a name the engine would have to interpolate must stop the replay, got {error}"
    );
}

#[test]
fn a_column_name_that_is_not_a_plain_identifier_is_refused() {
    let entries = vec![entry(RowOperation::Delete, Some(r#"{"ti\"tle":"x"}"#), None)];
    let error = plan(&entries, Replay::Inverse).expect_err("must not build a statement");

    assert!(
        matches!(&error, UndoError::UnsafeIdentifier(_)),
        "expected the column name to be refused, got {error}"
    );
}

#[test]
fn an_empty_gesture_plans_nothing() {
    assert!(plan(&[], Replay::Inverse).expect("plan").is_empty());
}
