//! Tauri commands for domain operations.

use tauri::State;

use crate::{
    database::DatabasePool,
    domains::{
        model::{CreateDomainRequest, Domain, DomainId, DomainSubtype, UpdateDomainRequest},
        DomainRepository,
    },
    error::WireError,
};

/// Creates a new domain (Project, Domain, or Tag).
#[tauri::command]
pub async fn create_domain(
    pool: State<'_, DatabasePool>,
    request: CreateDomainRequest,
) -> Result<Domain, WireError> {
    DomainRepository::new(&pool)
        .create(request)
        .await
        .map_err(WireError::from_error)
}

/// Fetches a domain by id.
#[tauri::command]
pub async fn get_domain(pool: State<'_, DatabasePool>, id: i64) -> Result<Domain, WireError> {
    DomainRepository::new(&pool)
        .get(DomainId(id))
        .await
        .map_err(WireError::from_error)
}

/// Lists all domains, optionally filtered by subtype.
#[tauri::command]
pub async fn list_domains(
    pool: State<'_, DatabasePool>,
    subtype: Option<DomainSubtype>,
) -> Result<Vec<Domain>, WireError> {
    DomainRepository::new(&pool)
        .list(subtype)
        .await
        .map_err(WireError::from_error)
}

/// Updates an existing domain.
#[tauri::command]
pub async fn update_domain(
    pool: State<'_, DatabasePool>,
    id: i64,
    request: UpdateDomainRequest,
) -> Result<Domain, WireError> {
    DomainRepository::new(&pool)
        .update(DomainId(id), request)
        .await
        .map_err(WireError::from_error)
}

/// Deletes a domain by id.
#[tauri::command]
pub async fn delete_domain(pool: State<'_, DatabasePool>, id: i64) -> Result<(), WireError> {
    DomainRepository::new(&pool)
        .delete(DomainId(id))
        .await
        .map_err(WireError::from_error)
}
