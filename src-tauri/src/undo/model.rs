//! The vocabulary of the Undo Journal: gestures, write sources, the ambient context, and the row
//! changes the engine replays.

use std::collections::BTreeSet;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::error::UndoError;

/// Who caused a write.
///
/// An enum rather than a boolean, and stored as a bare string with no CHECK constraint behind it,
/// so that a third source later is a change here and not a migration. Both sources are journaled;
/// only [`WriteSource::User`] entries ever enter the Undo Stack, because Ctrl+Z reverses what the
/// user did and never what an agent did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WriteSource {
    /// The person using the app, through a Tauri command.
    User,
    /// An agent, through the MCP server.
    Mcp,
}

impl WriteSource {
    /// The value stored in `undo_context.source` and `undo_journal.source`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Mcp => "mcp",
        }
    }
}

impl FromStr for WriteSource {
    type Err = UndoError;

    fn from_str(source: &str) -> Result<Self, Self::Err> {
        match source {
            "user" => Ok(Self::User),
            "mcp" => Ok(Self::Mcp),
            other => Err(UndoError::UnknownWriteSource(other.to_string())),
        }
    }
}

/// Identifies one [Gesture](super) — the unit Ctrl+Z reverses.
///
/// Minted by the database (`randomblob`) when a Gesture is opened over no other, so that no two
/// gestures in a session can collide and nothing in Rust has to hold a counter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GestureId(pub String);

impl std::fmt::Display for GestureId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The ambient write context every journal trigger reads: one row, shared by every connection.
///
/// A trigger takes no arguments, so the three things an entry needs that the changed row cannot
/// supply have to be somewhere the trigger can see them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndoContext {
    /// The Gesture writes currently belong to, or `None` when none is open.
    ///
    /// A write with no Gesture is still journaled — the journal is a faithful history — but is
    /// never offered as an undo step. Forgetting to open a Gesture makes a change un-undoable; it
    /// never makes Ctrl+Z reverse the wrong thing.
    pub gesture: Option<GestureId>,

    /// How many opens are stacked on the current Gesture, so that a Gesture spanning several
    /// commands is not closed by the first of them. Zero exactly when `gesture` is `None`.
    pub depth: i64,

    /// Who is writing.
    pub source: WriteSource,

    /// Whether the triggers are recording at all.
    ///
    /// Set by the undo path for the duration of its own transaction: applying an inverse is a
    /// write like any other and would otherwise be journaled as one.
    pub suppressed: bool,
}


/// What a journal entry says happened to one row.
///
/// The three cases are the whole of what the journal records, and each has exactly one inverse:
/// the inverse of an insert is a delete, of a delete an insert of the before image, and of an
/// update a write of the before image back over the row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RowOperation {
    /// A row came into existence.
    Insert,
    /// A row's columns changed.
    Update,
    /// A row ceased to exist.
    Delete,
}

impl RowOperation {
    /// The value stored in `undo_journal.operation`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Update => "update",
            Self::Delete => "delete",
        }
    }
}

impl FromStr for RowOperation {
    type Err = UndoError;

    fn from_str(operation: &str) -> Result<Self, Self::Err> {
        match operation {
            "insert" => Ok(Self::Insert),
            "update" => Ok(Self::Update),
            "delete" => Ok(Self::Delete),
            other => Err(UndoError::UnknownRowOperation(other.to_string())),
        }
    }
}

/// One row exactly as the journal recorded it: every column of its table, by name.
///
/// The triggers build it with `json_object(...)` over `pragma_table_info`, so a column is present
/// even when it is NULL — which is what makes restoring a row put every column back rather than
/// leaving the ones that happened to be empty at their current values.
#[derive(Debug, Clone, PartialEq)]
pub struct RowImage {
    /// The row's columns, keyed by column name.
    columns: Map<String, Value>,
}

impl RowImage {
    /// Reads an image out of the JSON the trigger wrote.
    ///
    /// Fails when the text is not a JSON object: the engine builds SQL from these column names, so
    /// an image it cannot read is a reason to stop rather than to restore a partial row.
    pub fn parse(json: &str) -> Result<Self, UndoError> {
        let value: Value = serde_json::from_str(json)
            .map_err(|error| UndoError::MalformedImage(error.to_string()))?;
        match value {
            Value::Object(columns) => Ok(Self { columns }),
            other => Err(UndoError::MalformedImage(format!(
                "expected a JSON object of columns, found {other}"
            ))),
        }
    }

    /// The row's columns, in name order.
    pub fn columns(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.columns.iter().map(|(name, value)| (name.as_str(), value))
    }

    /// Whether the image names a column.
    pub fn has_column(&self, name: &str) -> bool {
        self.columns.contains_key(name)
    }

    /// How many columns the image carries.
    pub fn len(&self) -> usize {
        self.columns.len()
    }

    /// Whether the image carries no columns at all.
    pub fn is_empty(&self) -> bool {
        self.columns.is_empty()
    }
}

/// One row change, read back out of `undo_journal` for replaying.
///
/// `row_id` is the SQLite rowid rather than a primary key, because six journaled tables have a
/// composite primary key and no id column at all. Restoring a deleted row by its original rowid is
/// what makes a deleted subtree come back whole: everything that referenced it still does.
#[derive(Debug, Clone, PartialEq)]
pub struct JournalEntry {
    /// The journal's total order, and the order a Gesture's entries are replayed in.
    pub seq: i64,
    /// The table the row belongs to.
    pub table: String,
    /// The row's SQLite rowid at the time of the change.
    pub row_id: i64,
    /// What happened to the row.
    pub operation: RowOperation,
    /// The row as it was, absent for an insert.
    pub before: Option<RowImage>,
    /// The row as it became, absent for a delete.
    pub after: Option<RowImage>,
}

/// One Gesture sitting on a stack, with the row changes that make it up.
///
/// The entries are **copies** taken out of the journal when the Gesture closed, not a reference
/// into it: the journal stays the faithful history ADR 0006 describes and is pruned on its own
/// schedule, while the stacks are a history of *the user* that outlives that pruning for as long
/// as the session does.
#[derive(Debug, Clone, PartialEq)]
pub struct StackedGesture {
    /// Which Gesture this is.
    gesture: GestureId,
    /// Its row changes, oldest first. Never empty.
    entries: Vec<JournalEntry>,
}

impl StackedGesture {
    /// Holds `entries` as `gesture`, or returns `None` when there is nothing to reverse.
    ///
    /// A Gesture that wrote nothing the user can undo — one that only read, or one whose writes
    /// were all an agent's — never reaches a stack at all. That is what keeps Ctrl+Z from
    /// consuming a press on a step with no effect, and what keeps an MCP write from clearing the
    /// Redo Stack.
    pub fn new(gesture: GestureId, entries: Vec<JournalEntry>) -> Option<Self> {
        if entries.is_empty() {
            return None;
        }
        Some(Self { gesture, entries })
    }

    /// Which Gesture this is.
    pub fn gesture(&self) -> &GestureId {
        &self.gesture
    }

    /// Its row changes, oldest first.
    pub fn entries(&self) -> &[JournalEntry] {
        &self.entries
    }

    /// What the UI needs to name this Gesture and decide whether to offer it.
    pub fn summary(&self) -> GestureSummary {
        let mut summary = GestureSummary {
            gesture: self.gesture.clone(),
            rows: self.entries.len(),
            inserted: 0,
            updated: 0,
            deleted: 0,
            tables: Vec::new(),
        };
        let mut tables = BTreeSet::new();
        for entry in &self.entries {
            match entry.operation {
                RowOperation::Insert => summary.inserted += 1,
                RowOperation::Update => summary.updated += 1,
                RowOperation::Delete => summary.deleted += 1,
            }
            tables.insert(entry.table.clone());
        }
        summary.tables = tables.into_iter().collect();
        summary
    }
}

/// What one Gesture on a stack amounts to, for a caller that has to label it.
///
/// Deliberately **counts and table names rather than a sentence**: the phrasing belongs to the
/// frontend, which is where the app's translations live, and undo speaks in rows anyway — it
/// restores what a row was, not what the user meant by changing it. A caller wanting "Undid:
/// delete 4 items" reads `deleted` and `tables`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GestureSummary {
    /// Which Gesture is being described.
    pub gesture: GestureId,
    /// How many rows it changed in total.
    pub rows: usize,
    /// How many rows it created.
    pub inserted: usize,
    /// How many rows it rewrote.
    pub updated: usize,
    /// How many rows it removed.
    pub deleted: usize,
    /// The tables it touched, in name order and without repetition.
    pub tables: Vec<String>,
}

/// Whether there is anything to undo or redo, and what each one is.
///
/// `None` means the stack is empty and the caller should disable its control; Ctrl+Z on an empty
/// stack is a silent no-op rather than an error, so this exists to label and disable, not to
/// prevent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UndoStatus {
    /// The Gesture the next undo would reverse.
    pub undo: Option<GestureSummary>,
    /// The Gesture the next redo would reapply.
    pub redo: Option<GestureSummary>,
}

#[cfg(test)]
mod tests;
