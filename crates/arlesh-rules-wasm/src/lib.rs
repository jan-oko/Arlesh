//! `arlesh-rules` for the frontend: the rules the optimistic lane predicts a write with (ADR 0012),
//! compiled to wasm32 so the board shows a press the way the writer will answer it, from the same
//! code and not a copy.
//!
//! Each export takes and returns plain JS values (serde-wasm-bindgen, JSON-compatible), and
//! tsify declares their TypeScript types. A malformed argument is a thrown `Error`, never a panic.
#![deny(missing_docs)]
#![deny(clippy::all)]

mod gestures;
mod parenting;
mod plan;
mod wire;

pub use gestures::*;
pub use parenting::*;
pub use plan::*;
