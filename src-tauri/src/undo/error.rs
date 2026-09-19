//! Errors raised while reading or writing the ambient undo context.

/// Something went wrong opening, closing or reading the Undo Journal's ambient context.
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

    /// A database error occurred.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
