//! Board filtering — the status presets, the tri-state override pills, the tag predicate and the
//! scope selector.
//!
//! This is the **definition** of what "Plan", "Start", "Do", "Backlog" and "Unblock" show. It was
//! written in TypeScript first, where the Mindmap and the List View both needed it; it lives here
//! now so that the MCP server answers "what should I start" with the same rules the user is
//! looking at, instead of an approximation an agent and a human can silently disagree about.
//!
//! # What is here and what is not
//!
//! The rules are pure functions of [`NodeFacts`](model::NodeFacts) — a small record carrying only
//! what a filter reads off a node, resolved scope windows included: whoever names a scope resolves
//! it before it arrives, which is what keeps the scope selector's comparisons here rather than
//! splitting them across a database call. Nothing here loads, queries or renders: [`facts`] turns a
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
//! # Deliberate divergences from `docs/spec/mindmap-view.md`
//!
//! This module reproduces the shipped frontend behaviour exactly, including the places where the
//! frontend and the specification do not agree. Each one is named at the rule that carries it, so
//! that the disagreement is documented rather than quietly promoted to the specification. See
//! [`rules::type_hard_hidden`] and [`list::passes_commitment_row`], and the corpus cases whose
//! `spec` field opens with DIVERGENCE or GAP.

pub mod facts;
pub mod list;
pub mod model;
pub mod rules;
pub mod tree;
