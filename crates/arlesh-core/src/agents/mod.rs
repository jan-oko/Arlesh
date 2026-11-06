//! Agents: the identities that work the board through the MCP, the **Claims** that bound what each
//! may see and write, and the **accounts** whose usage decides when they are at capacity.
//!
//! An unattached MCP session can do one thing: attach, with a one-time PIN from a signed-in client
//! (or with the token an earlier attach answered). The attach makes an [`model::Agent`] and binds
//! the session to it. An Agent may hold one [`model::Claim`] — a subtree, inside the user's MCP
//! roots, that is its whole view — and only one active Claim may cover any node.
//!
//! Layout, as elsewhere (ADR 0010): [`model`] values, [`rules`] pure rules, [`store`] the tables'
//! operator, [`service`] the composite operations that gather facts for the rules, [`secret`] the
//! random and the digests.
//!
//! The tables are not journaled: attaching or claiming is not a board edit, and Ctrl+Z must not
//! revoke an Agent. See `docs/spec/agents.md` and ADR 0018.

pub mod error;
pub mod model;
mod rows;
pub mod rules;
pub mod secret;
pub mod service;
pub mod store;

pub use store::AgentOperator;
