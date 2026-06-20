//! Tauri commands for domain operations.

use tauri::State;

use crate::{
    db::DbPool,
    domains::{
        model::{CreateDomainRequest, Domain, DomainId, DomainSubtype, UpdateDomainRequest},
        DomainRepository,
    },
};

/// Creates a new domain (Project, Domain, or Tag).
#[tauri::command]
pub async fn create_domain(
    pool: State<'_, DbPool>,
    req: CreateDomainRequest,
) -> Result<Domain, String> {
    DomainRepository::new(&pool)
        .create(req)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches a domain by id.
#[tauri::command]
pub async fn get_domain(pool: State<'_, DbPool>, id: i64) -> Result<Domain, String> {
    DomainRepository::new(&pool)
        .get(DomainId(id))
        .await
        .map_err(|e| e.to_string())
}

/// Lists all domains, optionally filtered by subtype.
#[tauri::command]
pub async fn list_domains(
    pool: State<'_, DbPool>,
    subtype: Option<DomainSubtype>,
) -> Result<Vec<Domain>, String> {
    DomainRepository::new(&pool)
        .list(subtype)
        .await
        .map_err(|e| e.to_string())
}

/// Updates an existing domain.
#[tauri::command]
pub async fn update_domain(
    pool: State<'_, DbPool>,
    id: i64,
    req: UpdateDomainRequest,
) -> Result<Domain, String> {
    DomainRepository::new(&pool)
        .update(DomainId(id), req)
        .await
        .map_err(|e| e.to_string())
}

/// Deletes a domain by id.
#[tauri::command]
pub async fn delete_domain(pool: State<'_, DbPool>, id: i64) -> Result<(), String> {
    DomainRepository::new(&pool)
        .delete(DomainId(id))
        .await
        .map_err(|e| e.to_string())
}
