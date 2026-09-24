//! Time scopes: Seasons, Months, Weeks, Days, Parts of Day, and Exact windows.
//!
//! A scope is **derived**, not stored (ADR 0009). Its identity is its value key
//! ([`key::ScopeKey`], e.g. `{"kind":"week","date":"2026-09-20"}`), and every field — label,
//! dates, bounds — is arithmetic over that key. Nothing in this module touches the database: a
//! column referencing a scope holds the key's canonical text, written and read by the key itself.

mod derive;
pub mod error;
pub mod key;
pub mod model;
pub mod resolve;
