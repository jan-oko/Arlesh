//! Operations that cut across the resource domains.
//!
//! Covers the things that act *on* a board rather than belonging to one resource: duplication,
//! retyping a node between kinds, the mindmap read path, the MCP server's tool adapter, and the
//! database connection and migration behaviour underneath all of them.
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

mod beads_commands;
mod database;
mod duplicate;
mod mcp;
mod mcp_access;
mod mcp_writes;
mod mindmap_commands;
mod preset_conformance;
mod retype_commands;
mod retype_info;
