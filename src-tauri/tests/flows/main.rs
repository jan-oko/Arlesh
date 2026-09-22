//! Flows, habits and their instances.
//!
//! Covers the `flows` domain end to end: flow and flow-item CRUD, conversion to and from
//! flows, recurrence and habit-iteration generation, the fan-in of a flow onto its target, and
//! the Tauri commands that front all of it.
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

mod flow_fan_in;
mod flows;
mod flows_commands;
mod occurrence_children;
