//! The structural resources a board is built from.
//!
//! Covers `domains` (aspects, projects, domains and tags), `scopes` (seasons, months, weeks
//! and days), `knowledge_base` (people, events and threads) and `infos` — the resources that
//! give tasks and goals somewhere to live, as opposed to the work itself.
//!
//! One binary per theme is deliberate. Tarpaulin pays a flat ~24.5s of ptrace setup
//! per test binary regardless of how many tests it holds — measured at 441s of setup
//! against 39s of actual test time across the 18 binaries this suite used to build —
//! so the binary count, not the test count, is what the coverage run costs.

// Shared by every group; the group root owns the declaration and members use
// `crate::helpers`. `#[path]` is needed because `tests/helpers/` is not a target of
// its own — that is the point, it holds no tests.
#[path = "../helpers/mod.rs"]
mod helpers;

mod documented_vocabularies;
mod domains;
mod infos;
mod knowledge_base;
mod scopes;
