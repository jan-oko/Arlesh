//! The node rules: what reading a derived node's attachments does to the stored rows
//! ([`attach`]), what a row may be done to ([`capabilities`]), which kinds may hold which
//! ([`parenting`]), and how a wait's check tasks, spawned waits and delegation waits are drawn
//! ([`waits`]).
//!
//! Pure functions over values: no session (`Db`, `SessionMode`), no `sqlx`, no `tauri`, no `tokio`
//! and no file system, and `now` is passed in rather than read. `scripts/check-rules-purity.sh`
//! enforces this in CI. See ADR 0010 and `.claude/rules/rust.md`.

pub mod attach;
pub mod capabilities;
pub mod parenting;
pub mod waits;
