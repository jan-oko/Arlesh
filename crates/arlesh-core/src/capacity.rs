//! Capacity: which Agentic Tasks read blocked because the agent holding them is at capacity.
//!
//! An agent is at capacity while it is locked by hand, its account is locked by hand, or a limit
//! window of its account is used up before its reset (see [`crate::agents`]). Its Claim's
//! Agentic Tasks not yet Done are then **derived blocked** — a dependency every such Task has — and
//! everything blocked already does follows: Start hides it, the app refuses to start it, the
//! blocked glyph shows. That derivation is [`blocks`], and it is the same for the app and the MCP.
//! See `docs/spec/agents.md`, "Capacity per account".
//!
//! There is no app-wide lock any more (removed 2026-11-08, Task 7a0): capacity belongs to an agent
//! and its account, derived from what they have reported, so it lifts by itself at the reset.

pub use rules::blocks;
pub mod rules;
