//! Tauri command entry points — thin wrappers that open a session from the
//! [`SessionFactory`](crate::database::session::SessionFactory) and delegate to a domain module.

pub mod access;
pub mod block_reasons;
pub mod board;
pub mod capacity;
pub mod client_mode;
pub mod commitments;
pub mod domains;
pub mod expectations;
pub mod flows;
pub mod gestures;
#[cfg(desktop)]
pub mod header_bar;
pub mod infos;
pub mod knowledge_base;
pub mod mcp_endpoint;
pub mod mindmap;
pub mod node_gestures;
pub mod scopes;
pub mod tasks;
/// The tray and close-to-tray are desktop-only; a phone has neither, and `mobile_shell` answers
/// their commands under the same names.
#[cfg(desktop)]
pub mod tray;

#[cfg(mobile)]
pub mod mobile_shell;
pub mod undo;
/// Tabs, tear-off windows and the saved window session are desktop-only.
#[cfg(desktop)]
pub mod windows;
#[cfg(mobile)]
pub use mobile_shell as tray;
#[cfg(mobile)]
pub use mobile_shell as windows;
