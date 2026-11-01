//! Which mode the app runs in on this device — Standalone or Client — and where a Client's server
//! and token are kept. See `docs/spec/client-mode.md`.
//!
//! The mode is a per-device setting, in `mode.json` in the app's data directory, beside the window
//! session and the other preferences that stay local. The token is not in it: it is in the OS
//! keychain ([`vault`]), or — only once the user agrees — in a file only they can read.

pub mod settings;
pub mod vault;
