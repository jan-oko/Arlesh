//! What replication moves between a server and a client's Replica: rows, and where the stream of
//! them stands. Plain values; the rules that make them live in [`super::rules`] and the reads that
//! fill them in [`super`].

use serde::{Deserialize, Serialize};

/// One replicated row as a change says it, or as the log was written: the row it names, in the
/// order it happened, and what it became.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowChange {
    /// Its place in the change log. Monotonic across the life of the database file.
    pub seq: i64,
    /// The table.
    pub table: String,
    /// The row's SQLite `rowid`: how a Replica names the row, since a table's own key may be a
    /// composite or change in the very write that is reported.
    pub rowid: i64,
    /// The row after the change, in [canonical form](super::rules::hash), or `None` when the row is
    /// gone.
    pub image: Option<String>,
}

/// One replicated row as a snapshot holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredRow {
    /// The table.
    pub table: String,
    /// The row's SQLite `rowid`.
    pub rowid: i64,
    /// The row in [canonical form](super::rules::hash).
    pub image: String,
}

/// Where the replicated rows stand: how far along the change log they are, and their hash.
///
/// A client that holds the rows up to `upto` computes the same `hash` over them
/// ([`super::rules::hash::board_hash`]); a difference means a row changed behind the feed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceHead {
    /// The change-log position the rows are at.
    pub upto: i64,
    /// The hash of every replicated row at that position, as 16 lowercase hex digits.
    pub hash: String,
}

/// What one publication says about the replicated rows: the rows that changed since the one before,
/// and the chain that lets a client tell it missed one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceDelta {
    /// The position of the publication before: the delta applies to a client whose rows are at
    /// least here.
    pub base: i64,
    /// The position after this delta.
    pub upto: i64,
    /// The hash of every replicated row at `upto`, as 16 lowercase hex digits.
    pub hash: String,
    /// Each row that changed, once, as it last became, in log order.
    pub rows: Vec<RowChange>,
}

impl SourceDelta {
    /// Whether the delta changes no row.
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
}

/// Every replicated row, read in one transaction: what a device starts from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    /// The change-log position the rows are at.
    pub upto: i64,
    /// The hash of the rows, as 16 lowercase hex digits.
    pub hash: String,
    /// The newest migration the database has applied: client and server must agree on it.
    pub schema_version: i64,
    /// Every row of every replicated table, by table then `rowid`.
    pub rows: Vec<StoredRow>,
}
