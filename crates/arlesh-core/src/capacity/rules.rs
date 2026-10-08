//! The agent capacity lock's rule: which Tasks it blocks ([`blocks`]).
//!
//! Pure functions over values: no session (`Db`, `SessionMode`), no `sqlx`, no `tauri`, no `tokio`
//! and no file system, and `now` is passed in rather than read. `scripts/check-rules-purity.sh`
//! enforces this in CI. See ADR 0010 and `.claude/rules/rust.md`.
//!
//! The submodules are re-exported at their old paths in the parent module, so callers did not
//! change when they moved here.

pub mod blocks;
