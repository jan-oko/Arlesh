//! The board hash: a fingerprint of every replicated row, and exactly what it covers, so a
//! Replica can compute the same number over its own copy and catch a row that changed behind the
//! feed.
//!
//! # What it covers
//!
//! **Every row of every replicated table** ([`super::is_replicated`]): the source rows, not the
//! derived board (`docs/adr/0020-changed-nodes-and-board-hash.md` hashes that for the windows).
//!
//! # Canonical form
//!
//! A row's **image** is the text SQLite's own `json_object('column', value, …)` makes of it, over the
//! table's columns in schema order, less [`super::OMITTED_COLUMNS`]. It is what the change-log
//! triggers write and what a snapshot reads, so the server never builds one itself, and a Replica
//! that applied the rows as given and reads its own back with the same query ([`super::super::row_query`])
//! gets the same text: integers stay integers, text is escaped as SQLite escapes it, a NULL is `null`.
//!
//! A row's **digest** is FNV-1a (64 bit) over the UTF-8 bytes of `table`, a zero byte, the row's
//! `rowid` in decimal, a zero byte and the image. The **board hash** is the sum of every row's digest,
//! wrapping at 2^64, written as 16 lowercase hex digits. A sum, not a chain, so it does not depend on
//! the order rows are read in and can be kept current by adding and removing rows.
//!
//! The `rowid` is part of the digest because a Replica names a row by it (it is how a deletion is
//! reported), so two copies agree only when they agree on it.

use super::super::model::StoredRow;

const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x0000_0100_0000_01b3;

/// The digest of one row: see the [module](self) for the form.
pub fn row_digest(table: &str, rowid: i64, image: &str) -> u64 {
    let rowid = rowid.to_string();
    let parts: [&[u8]; 5] = [
        table.as_bytes(),
        b"\0",
        rowid.as_bytes(),
        b"\0",
        image.as_bytes(),
    ];
    parts
        .iter()
        .flat_map(|part| part.iter())
        .fold(OFFSET_BASIS, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(PRIME)
        })
}

/// The board hash of `rows`, as a number.
pub fn board_hash_value(rows: &[StoredRow]) -> u64 {
    rows.iter().fold(0u64, |sum, row| {
        sum.wrapping_add(row_digest(&row.table, row.rowid, &row.image))
    })
}

/// The board hash of `rows`, as it is published: 16 lowercase hex digits.
pub fn board_hash(rows: &[StoredRow]) -> String {
    format(board_hash_value(rows))
}

/// A hash as it is published.
pub fn format(hash: u64) -> String {
    format!("{hash:016x}")
}
