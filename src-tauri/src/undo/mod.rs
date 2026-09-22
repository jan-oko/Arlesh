//! The Undo Journal: a row-level history of the board, written by triggers.
//!
//! Every change to a journaled table lands in `undo_journal` as a before image, an after image,
//! or both — written by a SQL trigger, not by the command that made the change. There are 83
//! mutating commands; an inverse written per command is an obligation that has to be met 83 times
//! and again by every command written later, while a trigger cannot be forgotten by a command that
//! does not know it exists. See `docs/adr/0006-undo-via-a-trigger-written-row-journal.md`.
//!
//! This module owns the half of that design that is not SQL: the **ambient context** the triggers
//! read, the lifecycle of the journal itself, and the engine that reads the journal back.
//!
//! # The two stacks
//!
//! [`UndoStacks`] holds what the user did and what undo took back — one pair for the whole
//! application, in memory, cleared by a restart. A Gesture reaches the Undo Stack when
//! [`close_gesture`] ends it, carrying the `user` entries the journal recorded for it and nothing
//! else. [`undo`] takes the Gesture on top of that stack, applies the inverse of each of its
//! entries in reverse order inside **one** transaction, and moves it across to the Redo Stack;
//! [`redo`] does the same in the other direction. Neither writes a journal entry, because
//! reversing a change must not itself become a change to reverse.
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
//! to be set inside a transaction. That is what makes one shared row safe: a transaction
//! [`SessionFactory::begin`](crate::database::session::SessionFactory::begin) opens holds SQLite's
//! single writer lock from its `BEGIN` until its commit, so for the whole life of the flag no
//! other connection can write at all, and no other connection's rows can be journaled under this
//! writer's flag or lose their entries to it. WAL does not loosen that — it lets a *reader* run
//! alongside, on the last committed snapshot, and a reader journals nothing. Setting either on a
//! pooled session leaves it set for everyone until something puts it back.

pub mod error;
pub mod model;
pub mod stacks;
pub mod statement;

use sqlx::SqliteConnection;

use crate::database::session::SessionFactory;
use error::UndoError;
use model::{
    GestureId, GestureSummary, JournalEntry, RowImage, StackedGesture, UndoContext, WriteSource,
};
use stacks::{Stack, UndoStacks};
use statement::{Replay, SqlValue, Statement};

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

/// What closing a Gesture amounted to.
///
/// Two different questions, which used to be one and are not the same: *can the user take this
/// back*, and *did the board move*. A Gesture whose only writes were an agent's answers no to the
/// first and yes to the second — it never enters the user's Undo Stack, but a second window
/// showing that part of the board is now wrong.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GestureClose {
    /// What reached the Undo Stack, or `None` for a nested close or a Gesture the user cannot undo.
    pub undoable: Option<GestureSummary>,
    /// Whether the Gesture wrote to the board at all, whoever made the writes.
    ///
    /// Read straight off the journal rather than reported by the commands, which is what makes it
    /// impossible for a command to forget — see [`crate::board`].
    pub wrote: bool,
}

/// Closes one open Gesture and, when that ended it, puts it on the Undo Stack.
///
/// Returns what the Gesture amounted to — what the user can undo, and whether the board moved at
/// all. Both are empty for a nested close, which ends nothing. A Gesture that reaches the stack
/// also **empties the Redo Stack**: redo reapplies rows onto the board they were taken from, and a
/// new change means that is no longer the board in front of the user.
///
/// Pooled rather than transactional: the close and the read that follows it are two statements
/// with no invariant between them — the Gesture is already over, and the worst a reader racing
/// this could do is see the journal a moment early.
#[tracing::instrument(skip(factory, stacks))]
pub async fn close_gesture(
    factory: &SessionFactory,
    stacks: &UndoStacks,
) -> Result<GestureClose, UndoError> {
    let mut db = factory.connect().await?;
    let Some(gesture) = db.undo().close_gesture().await? else {
        return Ok(GestureClose::default());
    };
    let entries = db.undo().entries_for(&gesture).await?;
    // Asked before the entries are consumed, and of *all* of them: the Undo Stack wants the user's
    // writes, and the other windows want to know about anybody's.
    let wrote = !entries.is_empty();

    let Some(stacked) = StackedGesture::new(gesture, entries) else {
        return Ok(GestureClose {
            undoable: None,
            wrote,
        });
    };
    let summary = stacked.summary();
    stacks.record(stacked);
    tracing::info!(gesture = %summary.gesture, rows = summary.rows, "gesture is undoable");
    Ok(GestureClose {
        undoable: Some(summary),
        wrote,
    })
}

/// Reverses the most recent user Gesture, or does nothing when there is none.
///
/// Returns what it reversed, or `None` on an empty stack — a silent no-op rather than an error,
/// because a keystroke with nothing to act on is not a mistake the user made.
#[tracing::instrument(skip(factory, stacks))]
pub async fn undo(
    factory: &SessionFactory,
    stacks: &UndoStacks,
) -> Result<Option<GestureSummary>, UndoError> {
    replay_top(factory, stacks, Stack::Undo).await
}

/// Reapplies the most recently undone Gesture, or does nothing when there is none.
#[tracing::instrument(skip(factory, stacks))]
pub async fn redo(
    factory: &SessionFactory,
    stacks: &UndoStacks,
) -> Result<Option<GestureSummary>, UndoError> {
    replay_top(factory, stacks, Stack::Redo).await
}

/// Takes the Gesture on top of `from`, applies it, and moves it to the other stack.
///
/// The Gesture is taken off the stack before the replay and put back if the replay fails, so the
/// stacks and the board always agree: a failure leaves both exactly as they were, which is the
/// whole point of doing this in one transaction.
///
/// This is the one operation in the crate that opens its own transaction rather than joining a
/// caller's (ADR 0004). It has to: the transaction is not an implementation detail of the replay
/// but its definition — the boundary is where suppression is set and released, where foreign keys
/// are deferred to, and what makes a failure change nothing. There is no outer caller that could
/// own a boundary with those meanings.
async fn replay_top(
    factory: &SessionFactory,
    stacks: &UndoStacks,
    from: Stack,
) -> Result<Option<GestureSummary>, UndoError> {
    let Some(gesture) = stacks.take(from) else {
        tracing::debug!(?from, "nothing to replay");
        return Ok(None);
    };
    let summary = gesture.summary();

    match apply(factory, gesture.entries(), from.direction()).await {
        Ok(()) => {
            stacks.put(from.opposite(), gesture);
            tracing::info!(gesture = %summary.gesture, rows = summary.rows, ?from, "replayed");
            Ok(Some(summary))
        }
        Err(cause) => {
            stacks.put(from, gesture);
            Err(UndoError::ApplyFailed {
                gesture: summary.gesture,
                direction: match from {
                    Stack::Undo => "undo",
                    Stack::Redo => "redo",
                },
                cause: Box::new(cause),
            })
        }
    }
}

/// Applies `entries` in one transaction, or applies none of them.
///
/// The `?` on the replay drops the session without committing, which rolls back every statement it
/// ran **and** the suppression flag it set — the flag is a row in the same transaction, so there
/// is no failure path that can leave journalling off for the rest of the session.
async fn apply(
    factory: &SessionFactory,
    entries: &[JournalEntry],
    direction: Replay,
) -> Result<(), UndoError> {
    let mut db = factory.begin().await?;
    db.undo().replay(entries, direction).await?;
    db.commit().await?;
    Ok(())
}

/// One `undo_journal` row exactly as it is stored, before it becomes a [`JournalEntry`].
///
/// A named row rather than a six-wide tuple: two of its columns are `i64` and two are
/// `Option<String>`, so in a tuple nothing but position would keep them apart.
#[derive(sqlx::FromRow)]
struct JournalRow {
    /// The journal's total order.
    seq: i64,
    /// The table the changed row belongs to.
    table_name: String,
    /// The changed row's SQLite rowid.
    row_id: i64,
    /// `insert`, `update` or `delete`.
    operation: String,
    /// The row as it was, as JSON.
    before_image: Option<String>,
    /// The row as it became, as JSON.
    after_image: Option<String>,
}

impl JournalRow {
    /// Reads the row into the entry the engine replays, failing on anything the triggers could not
    /// have written.
    fn into_entry(self) -> Result<JournalEntry, UndoError> {
        Ok(JournalEntry {
            seq: self.seq,
            table: self.table_name,
            row_id: self.row_id,
            operation: self.operation.parse()?,
            before: self
                .before_image
                .as_deref()
                .map(RowImage::parse)
                .transpose()?,
            after: self
                .after_image
                .as_deref()
                .map(RowImage::parse)
                .transpose()?,
        })
    }
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

    /// Closes one [`open_gesture`](Self::open_gesture), and returns the Gesture that ended.
    ///
    /// The Gesture itself ends only when the outermost open is closed — a nested close returns
    /// `None` — and that is also when the journal is pruned back to [`MAX_JOURNALLED_GESTURES`],
    /// since it is the one moment at which a whole Gesture is known to be finished. It is for the
    /// same reason the moment the Gesture becomes undoable; see the free
    /// [`close_gesture`](super::close_gesture), which is what a caller with a stack to update
    /// should use.
    ///
    /// Returns [`UndoError::NoGestureOpen`] when nothing is open, rather than silently doing
    /// nothing: an unmatched close means the pairing above it is broken, and the next gesture
    /// would otherwise be closed by someone else's stray call.
    #[tracing::instrument(skip(self))]
    pub async fn close_gesture(&mut self) -> Result<Option<GestureId>, UndoError> {
        // Read before writing: the statement below sets `gesture_id` to NULL as it closes the
        // outermost open, and `UPDATE … RETURNING` on SQLite yields the *new* row, so the Gesture
        // that just ended cannot come back from the statement that ends it.
        let closing: Option<String> =
            sqlx::query_scalar("SELECT gesture_id FROM undo_context WHERE id = 1")
                .fetch_one(&mut *self.connection)
                .await?;

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

        if remaining > 0 {
            return Ok(None);
        }
        // Prune after the caller can no longer lose anything by it: the Gesture that just ended is
        // the newest and so is never what a prune drops, but reading it out first makes that a
        // fact about this order rather than about the cap.
        let ended = closing.map(GestureId);
        self.prune(MAX_JOURNALLED_GESTURES).await?;
        Ok(ended)
    }

    /// The `user` entries `gesture` produced, oldest first.
    ///
    /// Filtered by source, which is the whole of how an agent's write stays out of the user's
    /// Ctrl+Z. The filter is per *entry* rather than per Gesture on purpose: an MCP write that
    /// landed while a user Gesture happened to be open carries that Gesture's id, because the
    /// ambient context is one row for the whole application, and it is the `source` column that
    /// tells the two apart.
    #[tracing::instrument(skip(self))]
    pub async fn entries_for(
        &mut self,
        gesture: &GestureId,
    ) -> Result<Vec<JournalEntry>, UndoError> {
        let rows: Vec<JournalRow> = sqlx::query_as(
            "SELECT seq, table_name, row_id, operation, before_image, after_image \
               FROM undo_journal \
              WHERE gesture_id = ? AND source = ? \
              ORDER BY seq",
        )
        .bind(&gesture.0)
        .bind(WriteSource::User.as_str())
        .fetch_all(&mut *self.connection)
        .await?;

        rows.into_iter().map(JournalRow::into_entry).collect()
    }

    /// Applies `entries` in `direction`, with journalling suppressed for the duration.
    ///
    /// Three things make this all-or-nothing, and each is here for a case that would otherwise
    /// leave the board half-reversed:
    ///
    /// * **One transaction.** The session is already transactional by type, so a caller cannot
    ///   reach this method without one.
    /// * **Foreign keys deferred to the commit.** A Gesture's entries are replayed in sequence
    ///   order, but a deleted subtree's rows were not necessarily journaled parent-first, and a
    ///   restore that inserts a child before its parent would fail against an immediate foreign
    ///   key even though the state it is building is perfectly consistent. What has to hold is the
    ///   end state. A violation that is *real* still fails, at the commit, and rolls everything
    ///   back. SQLite resets the setting when the transaction ends.
    /// * **Every statement built before any of them runs.** An entry the engine cannot read stops
    ///   the replay while the board is still untouched.
    ///
    /// Suppression is restored before returning, and a failure does not need it to be: the flag
    /// lives in a row written inside this same transaction, so a rollback puts it back.
    #[tracing::instrument(skip(self, entries), fields(entries = entries.len()))]
    pub async fn replay(
        &mut self,
        entries: &[JournalEntry],
        direction: Replay,
    ) -> Result<(), UndoError> {
        let statements = statement::plan(entries, direction)?;

        sqlx::query("PRAGMA defer_foreign_keys = ON")
            .execute(&mut *self.connection)
            .await?;
        let previously = self.set_suppressed(true).await?;

        for statement in &statements {
            self.execute(statement).await?;
        }

        self.set_suppressed(previously).await?;
        Ok(())
    }

    /// Runs one built statement, binding its values in order.
    async fn execute(&mut self, statement: &Statement) -> Result<(), UndoError> {
        let mut query = sqlx::query(statement.sql());
        for value in statement.values() {
            query = match value {
                SqlValue::Null => query.bind(Option::<String>::None),
                SqlValue::Integer(integer) => query.bind(*integer),
                SqlValue::Real(real) => query.bind(*real),
                SqlValue::Text(text) => query.bind(text.clone()),
            };
        }
        query.execute(&mut *self.connection).await?;
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
