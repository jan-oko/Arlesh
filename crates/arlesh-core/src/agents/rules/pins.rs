//! PINs: how long one lives, and when a run of wrong ones shuts the door.

use chrono::{Duration, NaiveDateTime};

#[cfg(test)]
mod tests;

/// How many digits a PIN has.
pub const LENGTH: usize = 8;

/// How long a PIN can be used after it was asked for.
pub fn lifetime() -> Duration {
    Duration::minutes(5)
}

/// How many PINs may wait to be used at once: a flood of requests cannot fill the table.
pub const MAX_PENDING: usize = 10;

/// How many wrong PINs shut the door.
pub const MAX_FAILURES: usize = 5;

/// How long a wrong PIN counts against the door.
pub fn failure_memory() -> Duration {
    Duration::minutes(10)
}

/// Whether the door is shut at `now`: [`MAX_FAILURES`] wrong PINs within [`failure_memory`].
pub fn locked_out(failures: &[NaiveDateTime], now: NaiveDateTime) -> bool {
    failures
        .iter()
        .filter(|failed| now - **failed < failure_memory())
        .count()
        >= MAX_FAILURES
}

/// Whether a PIN that lapses at `expires_at` can still be used at `now`.
pub fn live(expires_at: NaiveDateTime, now: NaiveDateTime) -> bool {
    expires_at > now
}
