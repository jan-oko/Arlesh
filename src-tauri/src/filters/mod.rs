//! Board filtering — the status presets, the tri-state override pills and the tag predicate.
//!
//! This is the **definition** of what "Plan", "Start", "Do", "Backlog" and "Unblock" show. It was
//! written in TypeScript first, where the Mindmap and the List View both needed it; it lives here
//! now so that the MCP server answers "what should I start" with the same rules the user is
//! looking at, instead of an approximation an agent and a human can silently disagree about.
//!
//! # What is here and what is not
//!
//! The rules are pure functions of [`NodeFacts`](model::NodeFacts) — a small record carrying only
//! what a filter reads off a node. Nothing here loads, queries or renders: [`facts`] turns a
//! [`MindmapLoad`](crate::mindmap::model::MindmapLoad) into a tree of facts, [`tree`] prunes that
//! tree the way the Mindmap does, and [`list`] answers a flat task/commitment row the way the List
//! View does. The two surfaces share every predicate in [`rules`] and differ only in how they walk.
//!
//! # One definition, two evaluators
//!
//! The frontend still evaluates these rules in TypeScript, because its filter pass is synchronous
//! and per-render: routing it through Tauri IPC would put a round trip in front of every selection
//! move. The two evaluators are pinned together by a shared conformance corpus —
//! `conformance/preset-filters.json` at the repository root — which both
//! `tests/operations/preset_conformance.rs` here and `src/utils/preset-conformance.test.ts` in the
//! frontend replay. Neither side generates it: it is the specification written as data, so a rule
//! changed on one side alone turns the other side red.
//!
//! # Agreement with `docs/spec/`
//!
//! Porting these rules turned up five places where the shipped frontend and the specification did
//! not agree. Each has since been ruled on and the two brought back together — the specification
//! gained the sentence it was missing, or the code gained the rule it was missing — so every
//! predicate here is the written rule, not a reproduction of a disagreement. The corpus case for
//! each of them names the sentence it now comes from.

pub mod facts;
pub mod list;
pub mod model;
pub mod rules;
pub mod tree;
