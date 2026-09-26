//! Tasks, goals, blockers and dependencies.
//!
//! Covers the `tasks` domain: task and goal CRUD, status and lifecycle, dependency edges and
//! cycle detection, and the normalized block-reason list that both tasks and goals carry.
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

mod agentic;
mod async_templates;
mod block_reasons;
mod expectations;
mod plan_overdue;
mod tasks;
mod wait_rows;
