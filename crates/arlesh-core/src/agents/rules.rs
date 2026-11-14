//! Agents' rules: which Claims may stand together, when an account is at capacity, how a PIN
//! lapses and how names are kept.
//!
//! Pure functions over values: no session (`Db`, `SessionMode`), no `sqlx`, no `tauri`, no `tokio`
//! and no file system, and `now` is passed in rather than read. `scripts/check-rules-purity.sh`
//! enforces this in CI. See ADR 0010 and `.claude/rules/rust.md`.

pub mod claims;
pub mod names;
pub mod pins;
pub mod refusals;
pub mod usage;
