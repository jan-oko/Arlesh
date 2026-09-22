//! Errors raised while recording the Undo Journal or replaying it.

use super::model::GestureId;

/// Something went wrong opening, closing or reading the Undo Journal's ambient context, or
/// applying one of its Gestures.
#[derive(Debug, thiserror::Error)]
pub enum UndoError {
    /// A Gesture was closed that was never opened.
    ///
    /// Opening and closing are paired by the caller, so this says the pairing is broken — a stray
    /// close, or one close too many for the opens above it — not that anything about the write
    /// failed.
    #[error("no gesture is open")]
    NoGestureOpen,

    /// The `source` column held a value no [`WriteSource`](super::model::WriteSource) names.
    ///
    /// Only a write from outside this crate can produce it: the column carries no CHECK
    /// constraint, deliberately, so that a third write source is a Rust change and not a
    /// migration.
    #[error("unknown write source \"{0}\"")]
    UnknownWriteSource(String),

    /// The `operation` column held a value no
    /// [`RowOperation`](super::model::RowOperation) names.
    ///
    /// The journal's own CHECK constraint admits exactly three, so this can only come from a
    /// journal written by something other than the triggers.
    #[error("unknown row operation \"{0}\"")]
    UnknownRowOperation(String),

    /// A row image could not be read back as the row it recorded.
    ///
    /// The triggers write every image with `json_object` over the table's own columns, so an image
    /// that is not an object of scalars did not come from them. Undo stops rather than restoring
    /// what it can: a row put back with some of its columns is worse than a row not put back.
    #[error("row image is malformed: {0}")]
    MalformedImage(String),

    /// A journal entry does not carry what its operation requires.
    #[error("journal entry {seq} on \"{table}\" cannot be applied: {reason}")]
    MalformedEntry {
        /// The entry's place in the journal's total order.
        seq: i64,
        /// The table it names.
        table: String,
        /// What is wrong with it.
        reason: String,
    },

    /// The journal names a table or column that is not a plain identifier.
    ///
    /// Table and column names are the one part of a replay's SQL that cannot be a binding, so a
    /// name the engine will not interpolate stops the replay instead.
    #[error("\"{0}\" is not an identifier the undo engine will interpolate")]
    UnsafeIdentifier(String),

    /// A Gesture could not be applied, and nothing was changed.
    ///
    /// The whole replay runs in one transaction with foreign keys deferred to the commit, so the
    /// failure this names is the *only* outcome other than the Gesture being applied whole. The
    /// Gesture is back on the stack it came from.
    #[error("could not {direction} {gesture}, and the board is unchanged: {cause}")]
    ApplyFailed {
        /// Which Gesture failed.
        gesture: GestureId,
        /// `undo` or `redo`, so the message reads as the thing the user asked for.
        direction: &'static str,
        /// Why it failed.
        #[source]
        cause: Box<UndoError>,
    },

    /// A Gesture could not be taken back, and its writes stand.
    ///
    /// The opposite claim to [`ApplyFailed`](Self::ApplyFailed), and deliberately worded to say
    /// so: there the board is untouched, while an abort that cannot reverse what the Gesture
    /// already wrote leaves exactly the half-applied state the abort existed to prevent. The
    /// Gesture is put on the Undo Stack on the way out, so the user has a Ctrl+Z for it.
    #[error("could not take back {gesture}; its changes stand, and are the next undo: {cause}")]
    AbortFailed {
        /// Which Gesture could not be taken back.
        gesture: GestureId,
        /// Why the reversal failed.
        #[source]
        cause: Box<UndoError>,
    },

    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
