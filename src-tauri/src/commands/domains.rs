//! Tauri commands for domain operations.

use tauri::State;

use crate::backend::AppBackend;
use crate::{
    domains::model::{CreateDomainRequest, Domain, DomainSubtype, UpdateDomainRequest},
    duplicate::DuplicatedSubtree,
    error::WireError,
};

/// Creates a new domain (Project, Domain, or Tag).
///
/// Multi-statement (an insert followed by a position update), so it runs on a transactional
/// session: without the [`commit`](crate::database::session::Db::commit) below, sqlx rolls the
/// whole creation back when the session drops.
#[tauri::command]
pub async fn create_domain(
    backend: State<'_, AppBackend>,
    request: CreateDomainRequest,
) -> Result<Domain, WireError> {
    backend.create_domain(request).await
}

/// Fetches a domain by id.
#[tauri::command]
pub async fn get_domain(backend: State<'_, AppBackend>, id: i64) -> Result<Domain, WireError> {
    backend.get_domain(id).await
}

/// Lists all domains, optionally filtered by subtype.
#[tauri::command]
pub async fn list_domains(
    backend: State<'_, AppBackend>,
    subtype: Option<DomainSubtype>,
) -> Result<Vec<Domain>, WireError> {
    backend.list_domains(subtype).await
}

/// Updates an existing domain.
///
/// A single-statement update (once the read/validate work is done), so it runs on a pooled
/// session — SQLite gives the one write statement-level atomicity on its own.
#[tauri::command]
pub async fn update_domain(
    backend: State<'_, AppBackend>,
    id: i64,
    request: UpdateDomainRequest,
) -> Result<Domain, WireError> {
    backend.update_domain(id, request).await
}

/// Deletes a domain by id.
///
/// A single-statement delete (once the read/validate work is done), so it runs on a pooled
/// session.
#[tauri::command]
pub async fn delete_domain(backend: State<'_, AppBackend>, id: i64) -> Result<(), WireError> {
    backend.delete_domain(id).await
}

/// Deep-clones a Project, Domain or Tag and its whole subtree under `target_id`, putting the new
/// root at `position`. Backs the Mindmap's Copy+Paste.
///
/// The target is always another domains-table row, which that table names by `parent_id` alone —
/// hence no target kind on the wire, unlike the goal, task and info duplicates.
///
/// Transactional: the subtree lands whole or not at all, Flows included. Returns the copy with
/// the rows hung on Habit occurrences that it could not carry, for the paste to name.
#[tauri::command]
pub async fn duplicate_domain(
    backend: State<'_, AppBackend>,
    id: i64,
    target_id: i64,
    position: i64,
) -> Result<DuplicatedSubtree<Domain>, WireError> {
    backend.duplicate_domain(id, target_id, position).await
}
