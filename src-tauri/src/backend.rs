//! The **Backend port**, as the app uses it.
//!
//! The port and both backends live in the `arlesh-backend` crate, which the Python bindings share;
//! they are re-exported here under the paths they had before the crate split, the way `lib.rs`
//! re-exports the core, so `crate::backend::tasks::TasksPort` in a command and
//! `arlesh_lib::backend::sqlite::SqliteBackend` in a test still name the same thing. What stays
//! here is what Tauri manages: [`AppBackend`].

use std::{ops::Deref, sync::Arc};

pub use arlesh_backend::*;

/// The backend the app runs on, as Tauri manages it: every command resolves
/// `State<AppBackend>` and calls through it.
#[derive(Clone)]
pub struct AppBackend(Arc<dyn Backend>);

impl AppBackend {
    /// Wraps `backend` for Tauri to manage.
    pub fn new(backend: impl Backend + 'static) -> Self {
        Self(Arc::new(backend))
    }

    /// Wraps a backend the app also holds elsewhere: Client mode's, which the change stream and
    /// the status commands reach too.
    pub fn shared(backend: Arc<dyn Backend>) -> Self {
        Self(backend)
    }
}

impl Deref for AppBackend {
    type Target = dyn Backend;

    fn deref(&self) -> &Self::Target {
        self.0.as_ref()
    }
}
