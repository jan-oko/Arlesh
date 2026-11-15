//! Minting the id of a row about to be created.
//!
//! A new row's id is a UUIDv7 (ADR 0017, decision 9): time-ordered, so rows made together sort
//! together, and random enough that two devices never pick the same. A caller that already has an id
//! (a client creating a row it has shown) sends it; every other path asks here.

use super::id::RowId;

/// A fresh UUIDv7.
pub fn new_row_id() -> RowId {
    uuid::Uuid::now_v7().hyphenated()
}
