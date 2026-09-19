//! The vocabulary of the Undo Journal: gestures, write sources, and the ambient context.

use std::str::FromStr;

use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
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
}
