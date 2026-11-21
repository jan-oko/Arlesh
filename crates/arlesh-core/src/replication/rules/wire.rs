//! The JSON replication puts on the wire: the `source` a live event carries and the device
//! snapshot's body.
//!
//! Images travel as the text SQLite wrote ([`super::hash`]), embedded raw so their column order and
//! number formats are the ones the hash was taken over.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::value::RawValue;

use super::{
    super::model::{RowChange, Snapshot, SourceDelta},
    by_table,
};

/// One row of a live event's `source.rows`.
#[derive(Serialize)]
struct EventRow<'a> {
    table: &'a str,
    rowid: i64,
    /// The row's place in the change log; a client that already holds up to a position skips rows at
    /// or before it.
    seq: i64,
    /// `set`: the row is now `image`. `del`: the row is gone.
    op: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<Box<RawValue>>,
}

/// A live event's `source`: `{base, upto, hash, rows}`.
#[derive(Serialize)]
struct EventSource<'a> {
    base: i64,
    upto: i64,
    hash: &'a str,
    rows: Vec<EventRow<'a>>,
}

fn raw(image: &str) -> Result<Box<RawValue>, serde_json::Error> {
    RawValue::from_string(image.to_owned())
}

fn event_row(change: &RowChange) -> Result<EventRow<'_>, serde_json::Error> {
    Ok(EventRow {
        table: &change.table,
        rowid: change.rowid,
        seq: change.seq,
        op: if change.image.is_some() { "set" } else { "del" },
        image: change.image.as_deref().map(raw).transpose()?,
    })
}

/// What the delta adds to an event's size on the wire, close enough to decide whether the event is
/// too large to send.
pub fn event_len(delta: &SourceDelta) -> usize {
    delta
        .rows
        .iter()
        .map(|row| row.table.len() + row.image.as_deref().map_or(0, str::len) + 64)
        .sum::<usize>()
        + 96
}

/// The `source` of a live event, as JSON.
pub fn event_source(delta: &SourceDelta) -> Result<String, serde_json::Error> {
    let rows = delta
        .rows
        .iter()
        .map(event_row)
        .collect::<Result<Vec<_>, _>>()?;
    serde_json::to_string(&EventSource {
        base: delta.base,
        upto: delta.upto,
        hash: &delta.hash,
        rows,
    })
}

/// One row of a snapshot: its `rowid` and image.
#[derive(Serialize)]
struct SnapshotRow {
    rowid: i64,
    image: Box<RawValue>,
}

/// Where a snapshot's rows stand.
#[derive(Serialize)]
struct SnapshotSource<'a> {
    upto: i64,
    hash: &'a str,
    count: usize,
}

/// The device snapshot's body.
#[derive(Serialize)]
struct SnapshotBody<'a> {
    epoch: &'a str,
    revision: u64,
    schema_version: i64,
    source: SnapshotSource<'a>,
    tables: BTreeMap<&'a str, Vec<SnapshotRow>>,
}

/// The device snapshot as JSON: the run (`epoch`) and the `revision` it is at least at, the schema
/// version, where the rows stand in the change log (`source`: `upto`, their `hash` and how many)
/// and every replicated row by table.
pub fn snapshot_body(
    snapshot: &Snapshot,
    epoch: &str,
    revision: u64,
) -> Result<String, serde_json::Error> {
    let mut tables = BTreeMap::new();
    for (table, rows) in by_table(&snapshot.rows) {
        let rows = rows
            .into_iter()
            .map(|row| {
                Ok(SnapshotRow {
                    rowid: row.rowid,
                    image: raw(&row.image)?,
                })
            })
            .collect::<Result<Vec<_>, serde_json::Error>>()?;
        tables.insert(table, rows);
    }
    serde_json::to_string(&SnapshotBody {
        epoch,
        revision,
        schema_version: snapshot.schema_version,
        source: SnapshotSource {
            upto: snapshot.upto,
            hash: &snapshot.hash,
            count: snapshot.rows.len(),
        },
        tables,
    })
}
