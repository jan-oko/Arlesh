//! Arlesh's pure rules layer and the domain models it reads (ADR 0010, ADR 0015).
//!
//! Values in, values out: no session, no database driver, no runtime and no host. Every module
//! here keeps the path it had in `arlesh-core`, which re-exports it, so a caller never learns
//! which crate a rule lives in. The wasm build (`arlesh-rules-wasm`) hands these same rules to the
//! frontend.
#![deny(missing_docs)]
#![deny(clippy::all)]

pub mod flows;
pub mod nodes;
pub mod scopes;
pub mod tasks;
pub mod wire;
