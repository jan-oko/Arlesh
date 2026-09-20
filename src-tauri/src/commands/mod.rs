//! Tauri command entry points — thin wrappers that open a session from the
//! [`SessionFactory`](crate::database::session::SessionFactory) and delegate to a domain module.

pub mod block_reasons;
pub mod commitments;
pub mod domains;
pub mod flows;
pub mod infos;
pub mod knowledge_base;
pub mod mindmap;
pub mod retype;
pub mod scopes;
pub mod tasks;
pub mod tray;
pub mod undo;
