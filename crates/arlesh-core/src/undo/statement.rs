//! Turning one journal entry into the statement that applies it.
//!
//! This is the whole of the engine's knowledge about SQL, and it is deliberately **pure**: a
//! [`JournalEntry`] goes in and a [`Statement`] comes out, with no connection anywhere near it.
//! The inverse of an insert is a delete of that row, of a delete an insert of the before image,
//! and of an update a write of the before image back over the row — three sentences that are much
//! easier to check here than they would be interleaved with `await`s.
//!
//! # Why the row is found by its rowid
//!
//! Every statement locates its row by `rowid`, which the journal records, and a restored row is
//! **inserted at its original rowid**. That is the reason the whole feature is row-level rather
//! than command-level: a deleted goal that comes back at a different id comes back as an orphan,
//! with its children, tags, dependencies and block reasons pointing at nothing.
//!
//! The one shape this does not handle is an update that rewrites a rowid — that is, one that
//! changes an `INTEGER PRIMARY KEY` column, which SQLite aliases to the rowid. Nothing in this app
//! rewrites a surrogate id, and an entry's `row_id` is the rowid *after* the change, so the
//! inverse would still find the row and the before image would put the id back; only a *redo* of
//! such an update would look for a row that is no longer there. If a command ever starts rewriting
//! ids, this is the assumption that has to be revisited.

use crate::undo::error::UndoError;
use crate::undo::model::{JournalEntry, RowImage, RowOperation};

/// A value bound into a [`Statement`], in the four types SQLite stores.
///
/// Built from the JSON a trigger wrote with `json_object`, which is why there is no blob case:
/// `json_object` refuses a BLOB, and `tests/undo_journal.rs` fails the schema outright if a
/// journaled column ever declares one.
#[derive(Debug, Clone, PartialEq)]
pub enum SqlValue {
    /// SQL NULL.
    Null,
    /// An integer, and where a JSON boolean lands.
    Integer(i64),
    /// A floating-point number.
    Real(f64),
    /// Text.
    Text(String),
}

impl SqlValue {
    /// Reads one column of a row image.
    ///
    /// A JSON array or object can only mean the image is not what a trigger wrote, so it is an
    /// error rather than a serialisation back to text: restoring a column as the *string* `[1,2]`
    /// when the row held something else is the kind of quiet wrongness undo exists to avoid.
    fn read(column: &str, value: &serde_json::Value) -> Result<Self, UndoError> {
        match value {
            serde_json::Value::Null => Ok(Self::Null),
            serde_json::Value::Bool(flag) => Ok(Self::Integer(i64::from(*flag))),
            serde_json::Value::String(text) => Ok(Self::Text(text.clone())),
            serde_json::Value::Number(number) => match (number.as_i64(), number.as_f64()) {
                (Some(integer), _) => Ok(Self::Integer(integer)),
                (None, Some(real)) => Ok(Self::Real(real)),
                (None, None) => Err(UndoError::MalformedImage(format!(
                    "column \"{column}\" holds the number {number}, which is neither an integer \
                     nor a real"
                ))),
            },
            other => Err(UndoError::MalformedImage(format!(
                "column \"{column}\" holds {other}, which is not a value a row can hold"
            ))),
        }
    }
}

/// One statement that applies one journal entry, with its bindings in order.
///
/// Column and table names are interpolated — they cannot be bound — so they are checked by
/// [`identifier`] first, and everything that came out of a row image is a binding.
#[derive(Debug, Clone, PartialEq)]
pub struct Statement {
    /// The SQL, with `?` where a value goes.
    sql: String,
    /// The values, in the order the `?`s appear.
    values: Vec<SqlValue>,
}

impl Statement {
    /// The SQL to prepare.
    pub fn sql(&self) -> &str {
        &self.sql
    }

    /// The values to bind, in order.
    pub fn values(&self) -> &[SqlValue] {
        &self.values
    }
}

/// Which direction a Gesture's entries are being replayed in.
///
/// One enum rather than two code paths, because the two directions are one algorithm with one
/// parameter: undo walks the entries backwards and applies each one's inverse, redo walks them
/// forwards and applies each one again. Splitting them is how they drift apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Replay {
    /// Undo: each entry's inverse, newest change first.
    Inverse,
    /// Redo: each entry again, oldest change first.
    Forward,
}

impl Replay {
    /// `entries` in the order this replay applies them.
    ///
    /// Reverse sequence for an inverse, because a Gesture's later changes may depend on its
    /// earlier ones. The ordering is a courtesy rather than a guarantee: foreign keys are deferred
    /// to the commit for the whole replay (see [`crate::undo::UndoOperator::replay`]), so what has
    /// to hold is the end state, not every step on the way to it.
    fn ordered(self, entries: &[JournalEntry]) -> Vec<&JournalEntry> {
        let mut ordered: Vec<&JournalEntry> = entries.iter().collect();
        if self == Self::Inverse {
            ordered.reverse();
        }
        ordered
    }

    /// The statement that applies `entry` in this direction.
    fn statement(self, entry: &JournalEntry) -> Result<Statement, UndoError> {
        match (self, entry.operation) {
            (Self::Inverse, RowOperation::Insert) | (Self::Forward, RowOperation::Delete) => {
                remove_row(&entry.table, entry.row_id)
            }
            (Self::Inverse, RowOperation::Delete) => {
                insert_row(entry, image(entry, entry.before.as_ref(), "before")?)
            }
            (Self::Forward, RowOperation::Insert) => {
                insert_row(entry, image(entry, entry.after.as_ref(), "after")?)
            }
            (Self::Inverse, RowOperation::Update) => {
                overwrite_row(entry, image(entry, entry.before.as_ref(), "before")?)
            }
            (Self::Forward, RowOperation::Update) => {
                overwrite_row(entry, image(entry, entry.after.as_ref(), "after")?)
            }
        }
    }
}

/// The statements that apply `entries` in this direction, in the order they must run.
///
/// Built **before any of them runs**, so that an entry the engine cannot read stops the replay
/// while the board is still untouched rather than half-way through it.
pub fn plan(entries: &[JournalEntry], direction: Replay) -> Result<Vec<Statement>, UndoError> {
    direction
        .ordered(entries)
        .into_iter()
        .map(|entry| direction.statement(entry))
        .collect()
}

/// The image an entry must carry for the statement being built, or the reason it is unusable.
///
/// The schema's CHECK constraints already pin which image each operation carries, so this only
/// fires on a journal written by something other than the triggers — but a missing image would
/// otherwise become a restored row with no columns.
fn image<'entry>(
    entry: &'entry JournalEntry,
    image: Option<&'entry RowImage>,
    which: &str,
) -> Result<&'entry RowImage, UndoError> {
    let image = image.ok_or_else(|| UndoError::MalformedEntry {
        seq: entry.seq,
        table: entry.table.clone(),
        reason: format!(
            "a {} entry must carry a {which} image",
            entry.operation.as_str()
        ),
    })?;
    if image.is_empty() {
        return Err(UndoError::MalformedEntry {
            seq: entry.seq,
            table: entry.table.clone(),
            reason: format!("its {which} image names no columns"),
        });
    }
    Ok(image)
}

/// `DELETE FROM <table> WHERE rowid = <row_id>`.
fn remove_row(table: &str, row_id: i64) -> Result<Statement, UndoError> {
    Ok(Statement {
        sql: format!("DELETE FROM {} WHERE rowid = ?", identifier(table)?),
        values: vec![SqlValue::Integer(row_id)],
    })
}

/// `INSERT INTO <table> (rowid, …) VALUES (…)`, putting the row back where it was.
///
/// `rowid` is named explicitly so that a row without an `INTEGER PRIMARY KEY` — the six link and
/// dependency tables have composite keys and no id column — comes back at the identity everything
/// else in the database still refers to. On a table whose id column *is* the rowid the two agree,
/// and naming both is harmless; the one case where naming it would be a syntax error is a table
/// with a real column called `rowid`, so that is checked rather than assumed.
fn insert_row(entry: &JournalEntry, image: &RowImage) -> Result<Statement, UndoError> {
    let table = identifier(&entry.table)?;
    let mut columns = Vec::with_capacity(image.len() + 1);
    let mut values = Vec::with_capacity(image.len() + 1);

    if !image.has_column("rowid") {
        columns.push("rowid".to_string());
        values.push(SqlValue::Integer(entry.row_id));
    }
    for (column, value) in image.columns() {
        columns.push(identifier(column)?);
        values.push(SqlValue::read(column, value)?);
    }

    let placeholders = vec!["?"; values.len()].join(", ");
    Ok(Statement {
        sql: format!(
            "INSERT INTO {table} ({}) VALUES ({placeholders})",
            columns.join(", ")
        ),
        values,
    })
}

/// `UPDATE <table> SET … WHERE rowid = <row_id>`, writing every column of `image` back.
///
/// Every column, not the ones that differ: the journal records whole rows, and a column that is
/// rewritten to the value it already holds costs nothing, while a column left out because the
/// engine thought it had not changed is a field silently lost.
fn overwrite_row(entry: &JournalEntry, image: &RowImage) -> Result<Statement, UndoError> {
    let table = identifier(&entry.table)?;
    let mut assignments = Vec::with_capacity(image.len());
    let mut values = Vec::with_capacity(image.len() + 1);

    for (column, value) in image.columns() {
        assignments.push(format!("{} = ?", identifier(column)?));
        values.push(SqlValue::read(column, value)?);
    }
    values.push(SqlValue::Integer(entry.row_id));

    Ok(Statement {
        sql: format!(
            "UPDATE {table} SET {} WHERE rowid = ?",
            assignments.join(", ")
        ),
        values,
    })
}

/// `name` quoted for interpolation, or an error when it is not a plain identifier.
///
/// Table and column names reach this module from `undo_journal`, where a trigger put them from the
/// schema, so in a healthy database they are always plain. The check is here because they are the
/// one part of these statements that cannot be a binding: anything that ever wrote that table by
/// hand would otherwise be writing SQL into the undo path.
fn identifier(name: &str) -> Result<String, UndoError> {
    let plain = !name.is_empty()
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_');
    if plain {
        Ok(format!("\"{name}\""))
    } else {
        Err(UndoError::UnsafeIdentifier(name.to_string()))
    }
}

#[cfg(test)]
mod tests;
