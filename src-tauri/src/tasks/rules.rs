//! The task rules: what a compound Task reads as ([`compound`]); Timing, Resolution, Archival and
//! the Overdue flag ([`lifecycle`]); Review
//! ([`review`]), and the containment invariants and wait lifecycles ([`scope`]).
//!
//! Pure functions over values: no session (`Db`, `SessionMode`), no `sqlx`, no `tauri`, no `tokio`
//! and no file system, and `now` is passed in rather than read. `scripts/check-rules-purity.sh`
//! enforces this in CI. See ADR 0010 and `.claude/rules/rust.md`.
//!
//! The submodules are re-exported at their old paths in the parent module, so callers did not
//! change when they moved here.

pub mod agentic;
pub mod ancestry;
pub mod compound;
pub mod dependencies;
pub mod lifecycle;
pub mod review;
pub mod scope;
pub mod write;
