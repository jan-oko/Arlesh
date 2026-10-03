//! Opening a database for Python: the core's rules, with its refusals in wire form.

use std::path::Path;

use arlesh_core::database::{
    client::ClientId,
    open::{self as core_open, OpenError, OpenMode},
    session::SessionFactory,
};
use arlesh_core::error::WireErrorKind;
use serde_json::json;

use crate::errors::Failure;

/// Opens the database at `path`: read-only without a `client`, for writing as `client` with one.
pub(crate) async fn open(
    path: &Path,
    client: Option<&str>,
    force: bool,
) -> Result<SessionFactory, Failure> {
    let mode = match client {
        None => OpenMode::ReadOnly,
        Some(name) => OpenMode::Write {
            client: name.parse::<ClientId>().map_err(|error| {
                Failure::new(WireErrorKind::InvalidRequest, error.to_string())
                    .with_details(json!({ "reason": "invalid_client" }))
            })?,
            force,
        },
    };
    core_open::open(path, mode).await.map_err(refusal)
}

/// The wire form of a refused open. Each keeps a `WireError` kind, so a caller branching on kinds
/// needs nothing new, and says which refusal it is in `details.reason`.
fn refusal(error: OpenError) -> Failure {
    let message = error.to_string();
    match error {
        OpenError::Missing(path) => Failure::new(WireErrorKind::NotFound, message)
            .with_details(json!({ "reason": "missing", "path": path })),
        OpenError::HeldByApp(path) => Failure::new(WireErrorKind::NotPermitted, message)
            .with_details(json!({ "reason": "held_by_app", "path": path })),
        OpenError::SchemaBehind { pending } => Failure::new(WireErrorKind::InvalidRequest, message)
            .with_details(json!({ "reason": "schema_behind", "migrations": pending })),
        OpenError::SchemaAhead { unknown } => Failure::new(WireErrorKind::InvalidRequest, message)
            .with_details(json!({ "reason": "schema_ahead", "migrations": unknown })),
        OpenError::Hold(_) | OpenError::Migrate(_) | OpenError::Database(_) => {
            Failure::new(WireErrorKind::Database, message)
        }
    }
}
