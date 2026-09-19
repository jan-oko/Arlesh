//! The Undo Journal: a row-level history of the board, written by triggers.
//!
//! Every change to a journaled table lands in `undo_journal` as a before image, an after image,
//! or both — written by a SQL trigger, not by the command that made the change. There are 83
//! mutating commands; an inverse written per command is an obligation that has to be met 83 times
//! and again by every command written later, while a trigger cannot be forgotten by a command that
//! does not know it exists. See `docs/adr/0006-undo-via-a-trigger-written-row-journal.md`.
//!
//! This module owns the half of that design that is not SQL: the **ambient context** the triggers
//! read, and the lifecycle of the journal itself. It writes no journal entries and reads none —
//! applying the journal in reverse is a separate piece of work.
//!
//! # Gestures
//!
//! A **Gesture** is one thing the user did, and the unit Ctrl+Z reverses. It is not a command:
//! pasting five nodes issues five commands and is one Ctrl+Z. So the boundary has to be opened by
//! whoever knows that the five belong together, which is the caller — [`UndoOperator::open_gesture`]
//! and [`UndoOperator::close_gesture`] are that protocol, exposed over IPC as the `open_gesture`
//! and `close_gesture` commands.
//!
//! Opens nest, and a nested open **joins** the gesture already running rather than starting a
//! second one — the same rule ADR 0004 gives transactions, for the same reason: only the outermost
//! caller can know where the boundary belongs. So the frontend may open a gesture around every
//! command it invokes and additionally around a run of them, and the run wins.
//!
//! ## Where this is weak, and how it fails
//!
//! The protocol is the one part of the design that a caller can forget, and it is worth being
//! plain about what forgetting costs.
//!
//! * A multi-command gesture that forgets its outer open **degrades to per-command undo**: five
//!   separate Ctrl+Z presses instead of one. Annoying, not wrong.
//! * A command invoked with no gesture open at all is journaled with a NULL `gesture_id` and is
//!   **not undoable**. The journal stays a faithful history and the stack simply does not offer
//!   it. This is the deliberate direction of the failure: a change that Ctrl+Z ignores is
//!   recoverable by hand, while a Ctrl+Z that reverses something the user did not ask about is
//!   not.
//! * Two gestures open concurrently from different callers would interleave, because the context
//!   is one row for the whole application. There is one user and one board, and the Undo Stack is
//!   app-wide by decision, so this is a statement about the shape rather than a race anyone can
//!   reach from the UI.
//!
//! The seam narrows on its own as command logic moves into Rust: a gesture that is already one
//! backend call needs no protocol at all.
//!
//! # Suppression and sources
//!
//! [`UndoOperator::set_suppressed`] turns the triggers off for the writer that set it, and
//! [`UndoOperator::set_source`] tags writes as coming from somewhere other than the user. Both
//! return the value they replaced, because both are meant to be **restored** — and both are meant
//! to be set inside a transaction. That is what makes one shared row safe: the statement that sets
//! the flag takes SQLite's single writer lock, so from that moment until the commit no other
//! connection can write at all, and no other connection's rows can be journaled under this
//! writer's flag or lose their entries to it. Setting either on a pooled session leaves it set for
//! everyone until something puts it back.

pub mod error;
pub mod model;

use sqlx::SqliteConnection;

use crate::database::session::SessionFactory;
use error::UndoError;
use model::{GestureId, UndoContext, WriteSource};

/// Tables that are deliberately **not** journaled.
///
/// The list is part of the design, not an optimisation, and each entry is here for a reason that
/// would survive being asked about:
///
/// * `scopes` — a scope row is not authored, it is the calendar. It is instantiated on demand by
///   `ScopeOperator::get_or_create`, deduplicated by three uniqueness indexes, and never deleted
///   by anything in this codebase. Journalling it would have undo delete a row that the next read
///   recreates — and, when another item still references it, fail the undo outright against the
///   foreign keys. An item's own entry restores its reference to a scope; the scope itself needs
///   no restoring.
/// * `undo_context`, `undo_journal` — journalling the journal is a loop.
///
/// `sqlite_*` and `_sqlx_migrations` are infrastructure rather than board data and are excluded by
/// name wherever tables are enumerated; they are not listed here because nothing about them is a
/// design decision.
///
/// `tests/undo_journal.rs` reads this list, enumerates the schema from `sqlite_master`, and fails
/// when a table that is not on it has no triggers — so the exclusion list cannot quietly grow by
/// omission. `scripts/generate-undo-triggers.sh` holds the same list, for the other direction.
pub const EXCLUDED_TABLES: &[&str] = &["scopes", "undo_context", "undo_journal"];

/// How many Gestures the journal keeps before the oldest are dropped.
///
/// The stack is session-scoped and the journal is truncated at startup, so this is the only bound
/// a long session has. Entries with no Gesture count as one Gesture each, so an ungrouped write
/// cannot be kept alive by a group it never joined.
pub const MAX_JOURNALLED_GESTURES: usize = 100;

/// Empties the journal and clears the ambient context, at application start.
///
/// The Undo Stack is session-scoped: nothing should carry across runs, and a `suppressed` flag or
/// a half-open Gesture left behind by a crash mid-undo would otherwise silently stop the journal
/// recording for the whole of the next session.
#[tracing::instrument(skip(factory))]
pub async fn reset_journal(factory: &SessionFactory) -> Result<(), UndoError> {
    let mut db = factory.connect().await?;
    db.undo().reset().await
}

/// Reads and writes the ambient write context, and manages the journal's lifecycle.
///
/// Obtained as `db.undo()` and used inline; see [`Db`](crate::database::session::Db) for the
/// borrow rules and for where an operation belongs.
pub struct UndoOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut SqliteConnection,
}

impl<'session> UndoOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut SqliteConnection) -> Self {
        Self { connection }
    }

    /// Reads the ambient context every journal trigger sees.
    #[tracing::instrument(skip(self))]
    pub async fn context(&mut self) -> Result<UndoContext, UndoError> {
        let row: (Option<String>, i64, String, i64) = sqlx::query_as(
            "SELECT gesture_id, depth, source, suppressed FROM undo_context WHERE id = 1",
        )
        .fetch_one(&mut *self.connection)
        .await?;
        let (gesture_id, depth, source, suppressed) = row;
        Ok(UndoContext {
            gesture: gesture_id.map(GestureId),
            depth,
            source: source.parse()?,
            suppressed: suppressed != 0,
        })
    }

    /// Opens a Gesture, or joins the one already open, and returns the Gesture writes now belong
    /// to.
    ///
    /// Joining rather than nesting is the point: the outermost caller decides the boundary, so a
    /// paste that opens one gesture around five commands keeps it even though each command opens
    /// one of its own. Every open must be matched by a [`close_gesture`](Self::close_gesture).
    #[tracing::instrument(skip(self))]
    pub async fn open_gesture(&mut self) -> Result<GestureId, UndoError> {
        let gesture_id: String = sqlx::query_scalar(
            "UPDATE undo_context \
                SET gesture_id = COALESCE(gesture_id, lower(hex(randomblob(16)))), \
                    depth = depth + 1 \
              WHERE id = 1 \
          RETURNING gesture_id",
        )
        .fetch_one(&mut *self.connection)
        .await?;
        Ok(GestureId(gesture_id))
    }

    /// Closes one [`open_gesture`](Self::open_gesture).
    ///
    /// The Gesture itself ends only when the outermost open is closed; that is also when the
    /// journal is pruned back to [`MAX_JOURNALLED_GESTURES`], since it is the one moment at which
    /// a whole Gesture is known to be finished.
    ///
    /// Returns [`UndoError::NoGestureOpen`] when nothing is open, rather than silently doing
    /// nothing: an unmatched close means the pairing above it is broken, and the next gesture
    /// would otherwise be closed by someone else's stray call.
    #[tracing::instrument(skip(self))]
    pub async fn close_gesture(&mut self) -> Result<(), UndoError> {
        let remaining: i64 = sqlx::query_scalar(
            "UPDATE undo_context \
                SET depth = depth - 1, \
                    gesture_id = CASE WHEN depth - 1 = 0 THEN NULL ELSE gesture_id END \
              WHERE id = 1 AND depth > 0 \
          RETURNING depth",
        )
        .fetch_optional(&mut *self.connection)
        .await?
        .ok_or(UndoError::NoGestureOpen)?;

        if remaining == 0 {
            self.prune(MAX_JOURNALLED_GESTURES).await?;
        }
        Ok(())
    }

    // Both setters below read before they write. `UPDATE … RETURNING` on SQLite yields the *new*
    // row, so the replaced value cannot come back from the statement that replaces it; and a
    // caller that has to remember the old value itself in order to restore it is a caller that can
    // forget to.
    /// Tags subsequent writes on every connection with `source`, and returns the source it
    /// replaced.
    ///
    /// Call it as the first write of a transaction and restore the returned value as the last, so
    /// that the tag is true for exactly the writes it was set for — see the module docs on why the
    /// transaction is what makes one shared row safe.
    #[tracing::instrument(skip(self))]
    pub async fn set_source(&mut self, source: WriteSource) -> Result<WriteSource, UndoError> {
        let previous: String = sqlx::query_scalar("SELECT source FROM undo_context WHERE id = 1")
            .fetch_one(&mut *self.connection)
            .await?;
        sqlx::query("UPDATE undo_context SET source = ? WHERE id = 1")
            .bind(source.as_str())
            .execute(&mut *self.connection)
            .await?;
        previous.parse()
    }

    /// Turns journalling off (or back on) for every connection, and returns the flag it replaced.
    ///
    /// The undo path sets it for the duration of its own transaction: applying an inverse is a
    /// write like any other and would otherwise be journaled as one, so undo would record its own
    /// undoing. The same transaction rule as [`set_source`](Self::set_source) applies, and matters
    /// more here — a suppression left set drops every entry after it.
    #[tracing::instrument(skip(self))]
    pub async fn set_suppressed(&mut self, suppressed: bool) -> Result<bool, UndoError> {
        let previous: i64 = sqlx::query_scalar("SELECT suppressed FROM undo_context WHERE id = 1")
            .fetch_one(&mut *self.connection)
            .await?;
        sqlx::query("UPDATE undo_context SET suppressed = ? WHERE id = 1")
            .bind(i64::from(suppressed))
            .execute(&mut *self.connection)
            .await?;
        Ok(previous != 0)
    }

    /// Drops every entry outside the newest `max_gestures` Gestures, and returns how many it
    /// removed.
    ///
    /// An entry with no Gesture is its own Gesture for this purpose, so ungrouped writes age out
    /// one at a time instead of surviving as a single unbounded bucket.
    #[tracing::instrument(skip(self))]
    pub async fn prune(&mut self, max_gestures: usize) -> Result<u64, UndoError> {
        let removed = sqlx::query(
            "DELETE FROM undo_journal \
              WHERE COALESCE(gesture_id, 'entry:' || seq) NOT IN ( \
                    SELECT bucket FROM ( \
                        SELECT COALESCE(gesture_id, 'entry:' || seq) AS bucket, MAX(seq) AS newest \
                          FROM undo_journal \
                         GROUP BY bucket \
                         ORDER BY newest DESC \
                         LIMIT ?))",
        )
        .bind(i64::try_from(max_gestures).unwrap_or(i64::MAX))
        .execute(&mut *self.connection)
        .await?
        .rows_affected();
        Ok(removed)
    }

    /// Empties the journal and returns the ambient context to its defaults.
    ///
    /// Re-seeds the context row if it is missing, so that a journal which has somehow lost it
    /// starts recording again at the next launch instead of discarding every entry in silence —
    /// the triggers insert nothing when the row they read is not there.
    #[tracing::instrument(skip(self))]
    pub async fn reset(&mut self) -> Result<(), UndoError> {
        sqlx::query("DELETE FROM undo_journal")
            .execute(&mut *self.connection)
            .await?;
        sqlx::query(
            "INSERT INTO undo_context (id) VALUES (1) \
             ON CONFLICT (id) DO UPDATE \
                SET gesture_id = NULL, depth = 0, source = 'user', suppressed = 0",
        )
        .execute(&mut *self.connection)
        .await?;
        Ok(())
    }
}
