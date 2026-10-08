//! The hold on a database, for a long-lived writer: the lock the desktop app takes while it runs.
//!
//! A script's write-open only checks the hold ([`crate::opening`]). A writer that means to be
//! *the* writer for as long as it runs — `arlesh-server` — takes it, exactly as the app does, so a
//! second server or an app started meanwhile finds the database held.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use arlesh_core::database::hold::{AppHold, HoldError};
use arlesh_core::error::WireErrorKind;
use pyo3::prelude::*;
use serde_json::json;

use crate::errors::{raise, Failure};

/// A hold on a database, released by [`NativeHold::release`] or when the process ends.
#[pyclass(module = "arlesh._native")]
pub(crate) struct NativeHold {
    /// The hold while it is held; `None` once released.
    hold: Mutex<Option<AppHold>>,
}

#[pymethods]
impl NativeHold {
    /// Releases the hold. Releasing it twice does nothing.
    fn release(&self) {
        if let Ok(mut hold) = self.hold.lock() {
            hold.take();
        }
    }

    /// Whether it is still held.
    #[getter]
    fn held(&self) -> bool {
        self.hold.lock().map(|hold| hold.is_some()).unwrap_or(false)
    }
}

/// Takes the hold on the database at `path`, at once or not at all.
#[pyfunction]
pub(crate) fn hold(path: PathBuf) -> PyResult<NativeHold> {
    let hold = AppHold::acquire(&path).map_err(|error| raise(refusal(&path, error)))?;
    Ok(NativeHold {
        hold: Mutex::new(Some(hold)),
    })
}

/// The wire form of a hold that could not be taken.
fn refusal(path: &Path, error: HoldError) -> Failure {
    let message = error.to_string();
    match error {
        HoldError::Taken(_) => Failure::new(
            WireErrorKind::NotPermitted,
            format!(
                "{} is held by another writer (the Arlesh app, or another arlesh-server)",
                path.display()
            ),
        )
        .with_details(json!({ "reason": "held", "path": path })),
        HoldError::Io { .. } => Failure::new(WireErrorKind::Database, message),
    }
}
