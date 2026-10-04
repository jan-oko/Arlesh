//! The Flow and Habit rules: classifying a Habit's iterations ([`habits`]) and its cooldown
//! ([`cooldown`]).
//!
//! Pure functions over values: no session (`Db`, `SessionMode`), no `sqlx`, no `tauri`, no `tokio`
//! and no file system, and `now` is passed in rather than read. `scripts/check-rules-purity.sh`
//! enforces this in CI. See ADR 0010 and `.claude/rules/rust.md`.
//!
//! The submodules are re-exported at their old paths in the parent module, so callers did not
//! change when they moved here.

pub mod compound_readings;
pub mod cooldown;
pub mod cycle_grid;
pub mod fold;
pub mod habits;
pub mod instance_copies;
pub mod items;
pub mod occurrences;
pub mod schedule;
pub mod targets;
