#![deny(clippy::all)]
#![deny(missing_docs)]
//! Arlesh's core: the domain model, its rules, the session layer over the database, the undo
//! journal and the MCP endpoint.
//!
//! It is host-agnostic. The desktop app (`src-tauri`) and the Python bindings (`arlesh-py`) are two
//! hosts over it, and it depends on neither — in particular not on Tauri, which CI checks.

pub mod access;
pub mod block_reasons;
pub mod board;
pub mod capacity;
pub mod database;
pub mod domains;
pub mod duplicate;
pub mod error;
pub mod filters;
pub mod flows;
pub mod infos;
pub mod knowledge_base;
pub mod mcp;
pub mod mindmap;
pub mod nodes;
pub mod scopes;
pub mod tasks;
pub mod undo;
pub mod wire;
