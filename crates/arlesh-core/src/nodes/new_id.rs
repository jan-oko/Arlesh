//! Minting the id of a row about to be created.
//!
//! A new row's id is a UUIDv7 (ADR 0017, decision 9): time-ordered, so rows made together sort
//! together, and random enough that two devices never pick the same. A caller that already has an id
//! (a client creating a row it has shown) sends it; every other path asks here.
//!
//! A write that creates rows its caller never names (a copy, a Flow start, a fork) mints them here
//! too. A client that predicts such a write and sends it to the server would otherwise end with
//! different ids on each side. So a write may run **under a seed**: while one is set, the ids this
//! module mints are a function of the seed and of how many were minted before, so two databases that
//! run the same code over the same rows under the same seed mint the same ids. The client sends the
//! seed as the `X-Arlesh-Request-Id` header, and the server runs the call under it.

use std::future::Future;
use std::sync::atomic::{AtomicU32, Ordering};

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::id::RowId;

/// The seed a write runs under, and how many ids it has minted so far.
struct Seed {
    id: RowId,
    minted: AtomicU32,
}

tokio::task_local! {
    static SEED: Seed;
}

/// A fresh UUIDv7, or the next id of the seed this write runs under.
pub fn new_row_id() -> RowId {
    SEED.try_with(Seed::next_id)
        .unwrap_or_else(|_| Uuid::now_v7())
        .hyphenated()
}

/// Runs `work` with every id it mints a function of `seed`.
///
/// The seed lasts for the task `work` runs on: a task it spawns mints at random.
pub async fn with_seed<F: Future>(seed: RowId, work: F) -> F::Output {
    SEED.scope(
        Seed {
            id: seed,
            minted: AtomicU32::new(0),
        },
        work,
    )
    .await
}

/// The seed the current write runs under, for the caller that must tell another process.
pub fn current_seed() -> Option<RowId> {
    SEED.try_with(|seed| seed.id).ok()
}

impl Seed {
    /// The UUIDv7 with this seed's millisecond timestamp and random bits hashed from the seed and
    /// the count of ids minted before this one.
    fn next_id(&self) -> Uuid {
        let count = self.minted.fetch_add(1, Ordering::Relaxed);
        let digest = Sha256::new()
            .chain_update(self.id.as_uuid().as_bytes())
            .chain_update(count.to_be_bytes())
            .finalize();
        let mut random = [0u8; 10];
        random.copy_from_slice(&digest[..10]);
        // The seed's top 48 bits are a UUIDv7's millisecond timestamp; any other seed has bits there too.
        let milliseconds = (self.id.as_uuid().as_u128() >> 80) as u64;
        uuid::Builder::from_unix_timestamp_millis(milliseconds, &random).into_uuid()
    }
}

#[cfg(test)]
mod tests;
