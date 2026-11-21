//! The pure half of replication: which tables travel, how a row is written down and hashed, how a
//! burst of log entries becomes one change per row, and how a hash is kept up to date as rows change.
//!
//! Nothing here reads a database or a clock. The server (the publisher) and a client's Replica both
//! call these, so the two sides cannot disagree about what a row's canonical form or the board's
//! hash is.

pub mod apply;
pub mod hash;
pub mod wire;

use std::collections::{BTreeMap, HashMap};

use super::model::{RowChange, SourceDelta, SourceHead, StoredRow};

/// Tables that stay on the server: the undo journal's exclusions (credentials, pairings, push
/// registrations, the journal itself) and the change log's own two tables. `scripts/generate-undo-triggers.sh`
/// holds the same list, and `replication::tests` checks the schema against it.
pub const UNREPLICATED_TABLES: &[&str] = &[
    "undo_context",
    "undo_journal",
    "server_tokens",
    "pairing_pins",
    "agent_pins",
    "agent_pin_failures",
    "agent_account_usage",
    "connect_tokens",
    "push_devices",
    "push_sent",
    "change_log",
    "change_capture",
];

/// Columns whose image holds a stand-in for the stored value, as `(table, column, SQL
/// expression over the row's other columns)`. The row still applies under the schema the server
/// has (the column is `NOT NULL UNIQUE`), the stand-in is deterministic and holds nothing secret,
/// and the hash covers the stand-in, so both sides agree on it.
///
/// * `agents.token_sha256` is a credential, so a device gets `'redacted:' || id` (unique per row).
/// * `agents.last_seen_at` is bookkeeping rewritten on every request an agent makes, which no one
///   derives anything from: it is a constant, so such a write changes no image and is not logged.
pub const REDACTED_COLUMNS: &[(&str, &str, &str)] = &[
    ("agents", "token_sha256", "'redacted:' || \"id\""),
    ("agents", "last_seen_at", "NULL"),
];

/// How long a publisher's hold on the change-log capture lasts without being renewed, in seconds.
/// The publisher renews it on every turn (at least once a minute), and the triggers log only while
/// it is valid, so a crashed publisher stops the log growing by itself.
pub const CAPTURE_LEASE_SECONDS: i64 = 180;

/// What a publisher's turn finds the capture to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capture {
    /// The publisher holds it and the lease is valid: the log holds every change since its last turn.
    Renewed,
    /// Nobody holds it (never taken, released, or expired, the publisher's own included): the log
    /// has a gap, so the publisher starts again from the rows.
    Acquired,
    /// Another publisher holds a valid lease: this one must neither drain nor take it.
    Refused,
}

/// Decides what `mine` gets on a turn at `now`, given who holds the capture and until when.
pub fn decide_capture(owner: Option<&str>, leased_until: i64, now: i64, mine: &str) -> Capture {
    let valid = leased_until > now;
    match owner {
        Some(holder) if holder == mine && valid => Capture::Renewed,
        Some(_) if valid => Capture::Refused,
        _ => Capture::Acquired,
    }
}

/// The SQL expression an image uses for `column` of `table` when it is redacted.
pub fn redaction(table: &str, column: &str) -> Option<&'static str> {
    REDACTED_COLUMNS
        .iter()
        .find(|(t, c, _)| *t == table && *c == column)
        .map(|(_, _, expression)| *expression)
}

/// Whether `table` is replicated: a user table that is not on the server-only list. SQLite's own
/// tables and `_sqlx_migrations` are infrastructure, not data.
pub fn is_replicated(table: &str) -> bool {
    !table.starts_with("sqlite_")
        && table != "_sqlx_migrations"
        && !UNREPLICATED_TABLES.contains(&table)
}

/// One change per row: the last thing that happened to each `(table, rowid)`, in the order those
/// last things happened. A row inserted and deleted within the burst is reported as gone, which is
/// harmless to a client that never held it.
pub fn coalesce(entries: Vec<RowChange>) -> Vec<RowChange> {
    let mut last: HashMap<(String, i64), RowChange> = HashMap::new();
    for entry in entries {
        last.insert((entry.table.clone(), entry.rowid), entry);
    }
    let mut changes: Vec<RowChange> = last.into_values().collect();
    changes.sort_by_key(|change| change.seq);
    changes
}

/// The hash of the replicated rows, kept up to date as they change, and where in the change log it
/// stands. The publisher holds one; a Replica may hold one the same way.
#[derive(Debug, Clone, Default)]
pub struct SourceTracker {
    digests: HashMap<(String, i64), u64>,
    total: u64,
    upto: i64,
}

impl SourceTracker {
    /// A tracker over `rows`, which are the rows as of log position `upto`.
    pub fn seed(rows: &[StoredRow], upto: i64) -> Self {
        let mut tracker = Self {
            upto,
            ..Self::default()
        };
        for row in rows {
            tracker.set(&row.table, row.rowid, Some(&row.image));
        }
        tracker
    }

    /// Takes in `entries` (the log as it was read, oldest first) and answers what changed: one
    /// change per row, the position before and after, and the hash after.
    pub fn advance(&mut self, entries: Vec<RowChange>) -> SourceDelta {
        let base = self.upto;
        let rows = coalesce(entries);
        for change in &rows {
            self.set(&change.table, change.rowid, change.image.as_deref());
            self.upto = self.upto.max(change.seq);
        }
        SourceDelta {
            base,
            upto: self.upto,
            hash: hash::format(self.total),
            rows,
            resynced: false,
        }
    }

    /// Where the rows stand now.
    pub fn head(&self) -> SourceHead {
        SourceHead {
            upto: self.upto,
            hash: hash::format(self.total),
        }
    }

    fn set(&mut self, table: &str, rowid: i64, image: Option<&str>) {
        let key = (table.to_owned(), rowid);
        let replaced = match image {
            Some(image) => self
                .digests
                .insert(key, hash::row_digest(table, rowid, image)),
            None => self.digests.remove(&key),
        };
        if let Some(old) = replaced {
            self.total = self.total.wrapping_sub(old);
        }
        if let Some(image) = image {
            self.total = self
                .total
                .wrapping_add(hash::row_digest(table, rowid, image));
        }
    }
}

/// The rows of `rows` grouped by table, for a snapshot's body.
pub fn by_table(rows: &[StoredRow]) -> BTreeMap<&str, Vec<&StoredRow>> {
    let mut tables: BTreeMap<&str, Vec<&StoredRow>> = BTreeMap::new();
    for row in rows {
        tables.entry(row.table.as_str()).or_default().push(row);
    }
    tables
}
