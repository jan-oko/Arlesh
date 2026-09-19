//! Unit tests for the Undo Journal's vocabulary.
//!
//! A sibling file rather than an inline `mod tests`: `cargo llvm-cov` counts an inline test
//! body as source, which inflates the denominator of exactly the file the tests belong to.

use super::*;

#[test]
fn a_write_source_round_trips_through_its_stored_string() {
    for source in [WriteSource::User, WriteSource::Mcp] {
        assert_eq!(
            WriteSource::from_str(source.as_str()).expect("stored form must parse back"),
            source
        );
    }
}

#[test]
fn parsing_a_source_the_enum_does_not_name_reports_the_value_it_saw() {
    let error = WriteSource::from_str("scheduler").expect_err("must not parse");
    assert!(
        matches!(&error, UndoError::UnknownWriteSource(seen) if seen == "scheduler"),
        "expected the unparsed value to be carried, got {error}"
    );
}

#[test]
fn a_gesture_id_displays_as_the_bare_identifier() {
    assert_eq!(GestureId("abc123".into()).to_string(), "abc123");
}

#[test]
fn a_row_operation_round_trips_through_its_stored_string() {
    for operation in [
        RowOperation::Insert,
        RowOperation::Update,
        RowOperation::Delete,
    ] {
        assert_eq!(
            RowOperation::from_str(operation.as_str()).expect("stored form must parse back"),
            operation
        );
    }
}

#[test]
fn parsing_an_operation_the_journal_does_not_record_reports_the_value_it_saw() {
    let error = RowOperation::from_str("upsert").expect_err("must not parse");
    assert!(
        matches!(&error, UndoError::UnknownRowOperation(seen) if seen == "upsert"),
        "expected the unparsed value to be carried, got {error}"
    );
}

#[test]
fn a_row_image_carries_every_column_including_the_null_ones() {
    let image = RowImage::parse(r#"{"id":1,"title":"x","delegate_to":null}"#).expect("parses");

    assert_eq!(image.len(), 3);
    assert!(!image.is_empty());
    assert!(image.has_column("delegate_to"), "a NULL column is present, not omitted");
    assert_eq!(
        image.columns().map(|(name, _)| name).collect::<Vec<_>>(),
        ["delegate_to", "id", "title"]
    );
}

#[test]
fn an_image_that_is_not_an_object_of_columns_is_refused() {
    let error = RowImage::parse("[1, 2]").expect_err("a row is not an array");
    assert!(matches!(error, UndoError::MalformedImage(_)), "got {error}");

    let error = RowImage::parse("not json at all").expect_err("must not parse");
    assert!(matches!(error, UndoError::MalformedImage(_)), "got {error}");
}

#[test]
fn an_empty_image_is_readable_but_names_nothing() {
    let image = RowImage::parse("{}").expect("an empty object is still an object");
    assert!(image.is_empty());
    assert_eq!(image.len(), 0);
}
