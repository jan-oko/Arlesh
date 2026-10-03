#![deny(clippy::all)]
#![deny(missing_docs)]
//! Python bindings for `arlesh-core`: a second host beside the desktop app.
//!
//! This crate is the narrow native half of the `arlesh` Python package. It speaks JSON across the
//! boundary in both directions — every request is one tagged object ([`request::Request`]), every
//! answer the serde form the desktop frontend already receives — and the Python half turns that
//! into typed calls and pydantic models generated from the same types' JSON Schema
//! ([`schema::document`]). Keeping the native surface to a handful of entry points is what lets
//! the operation table live in one Rust `match` rather than in a hundred PyO3 signatures.
//!
//! Database calls are **async**: each returns an awaitable, run on the Tokio runtime
//! `pyo3-async-runtimes` owns. The pure rules ([`rules`]) do no I/O and are plain calls.
//!
//! A failure crosses as [`NativeError`] carrying a serialised `WireError` — its `kind`, `message`
//! and `details` — which the Python half raises as the exception class for that kind.

mod errors;
mod opening;
mod request;
mod rules;
mod schema;

use std::path::PathBuf;
use std::sync::Arc;

use arlesh_core::database::session::SessionFactory;
use pyo3::prelude::*;

use errors::{raise, NativeError};

/// An open database: the factory its sessions come from, and where it lives.
#[pyclass(module = "arlesh._native", frozen)]
struct NativeDatabase {
    /// Hands out every session a call runs in.
    factory: SessionFactory,
    /// The database file, for what lives beside it (the agent capacity lock).
    path: Arc<PathBuf>,
}

#[pymethods]
impl NativeDatabase {
    /// Runs one request — a JSON object tagged by `op` — and answers its result as JSON.
    fn call<'py>(&self, py: Python<'py>, request: String) -> PyResult<Bound<'py, PyAny>> {
        let factory = self.factory.clone();
        let path = Arc::clone(&self.path);
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            request::run(&factory, &path, &request)
                .await
                .map_err(raise)
        })
    }

    /// The client this database writes as, or `None` when it was opened read-only.
    #[getter]
    fn client(&self) -> Option<String> {
        if self.factory.is_read_only() {
            return None;
        }
        Some(self.factory.client().to_string())
    }

    /// Closes every connection, once calls still running have finished.
    fn close<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        let factory = self.factory.clone();
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            factory.close().await;
            Ok(())
        })
    }
}

/// Opens the database at `path`: read-only when `client` is `None`, otherwise for writing as
/// `client` — refused while the desktop app holds it, unless `force`.
#[pyfunction]
#[pyo3(signature = (path, client, force))]
fn open(py: Python<'_>, path: PathBuf, client: Option<String>, force: bool) -> PyResult<Bound<'_, PyAny>> {
    pyo3_async_runtimes::tokio::future_into_py(py, async move {
        let factory = opening::open(&path, client.as_deref(), force)
            .await
            .map_err(raise)?;
        Ok(NativeDatabase {
            factory,
            path: Arc::new(path),
        })
    })
}

/// Runs one pure rule — a JSON object tagged by `rule` — and answers its result as JSON.
#[pyfunction]
fn rule(request: &str) -> PyResult<String> {
    rules::run(request).map_err(raise)
}

/// The JSON Schema of every type the API takes or returns, as one document of `$defs`.
#[pyfunction]
fn json_schema() -> PyResult<String> {
    serde_json::to_string_pretty(&schema::document())
        .map_err(|error| pyo3::exceptions::PyRuntimeError::new_err(error.to_string()))
}

/// The native module, imported as `arlesh._native`.
#[pymodule]
fn _native(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_class::<NativeDatabase>()?;
    module.add_function(wrap_pyfunction!(open, module)?)?;
    module.add_function(wrap_pyfunction!(rule, module)?)?;
    module.add_function(wrap_pyfunction!(json_schema, module)?)?;
    module.add("NativeError", module.py().get_type::<NativeError>())?;
    Ok(())
}
