//! Tauri commands for domain operations.

use tauri::State;

use crate::{
    database::session::SessionFactory,
    domains::model::{CreateDomainRequest, Domain, DomainId, DomainSubtype, UpdateDomainRequest},
    duplicate::{duplicate_subtree, DuplicableKind},
    error::WireError,
};

/// Creates a new domain (Project, Domain, or Tag).
///
/// Multi-statement (an insert followed by a position update), so it runs on a transactional
/// session: without the [`commit`](crate::database::session::Db::commit) below, sqlx rolls the
/// whole creation back when the session drops.
#[tauri::command]
pub async fn create_domain(
    factory: State<'_, SessionFactory>,
    request: CreateDomainRequest,
) -> Result<Domain, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let domain = db
        .domains()
        .create(request)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(domain)
}

/// Fetches a domain by id.
#[tauri::command]
pub async fn get_domain(factory: State<'_, SessionFactory>, id: i64) -> Result<Domain, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.domains()
        .get(DomainId(id))
        .await
        .map_err(WireError::from_error)
}

/// Lists all domains, optionally filtered by subtype.
#[tauri::command]
pub async fn list_domains(
    factory: State<'_, SessionFactory>,
    subtype: Option<DomainSubtype>,
) -> Result<Vec<Domain>, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.domains().list(subtype).await.map_err(WireError::from_error)
}

/// Updates an existing domain.
///
/// A single-statement update (once the read/validate work is done), so it runs on a pooled
/// session — SQLite gives the one write statement-level atomicity on its own.
#[tauri::command]
pub async fn update_domain(
    factory: State<'_, SessionFactory>,
    id: i64,
    request: UpdateDomainRequest,
) -> Result<Domain, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.domains()
        .update(DomainId(id), request)
        .await
        .map_err(WireError::from_error)
}

/// Deletes a domain by id.
///
/// A single-statement delete (once the read/validate work is done), so it runs on a pooled
/// session.
#[tauri::command]
pub async fn delete_domain(factory: State<'_, SessionFactory>, id: i64) -> Result<(), WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.domains()
        .delete(DomainId(id))
        .await
        .map_err(WireError::from_error)
}

/// Deep-clones a Project, Domain or Tag and its whole subtree under `target_id`, putting the new
/// root at `position`. Backs the Mindmap's Copy+Paste.
///
/// The target is always another domains-table row, which that table names by `parent_id` alone —
/// hence no target kind on the wire, unlike the goal, task and info duplicates.
///
/// Transactional: the subtree lands whole or not at all.
#[tauri::command]
pub async fn duplicate_domain(
    factory: State<'_, SessionFactory>,
    id: i64,
    target_id: i64,
    position: i64,
) -> Result<Domain, WireError> {
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let new_id = duplicate_subtree(&mut db, DuplicableKind::Domain, id, "", target_id, position)
        .await
        .map_err(WireError::from_error)?;
    let domain = db
        .domains()
        .get(DomainId(new_id))
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(domain)
}
