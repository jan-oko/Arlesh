//! Tauri commands for scope operations.

use chrono::NaiveDate;
use tauri::State;

use crate::{
    db::DbPool,
    scopes::{model::{Scope, ScopeId, ScopeKind}, ScopeRepository},
};

/// Gets or creates the scope for a date at a given granularity.
#[tauri::command]
pub async fn get_or_create_scope(
    pool: State<'_, DbPool>,
    kind: ScopeKind,
    date: String,
) -> Result<Scope, String> {
    let d = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|e| format!("invalid date: {}", e))?;
    ScopeRepository::new(&pool)
        .get_or_create(kind, d)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches a scope by id.
#[tauri::command]
pub async fn get_scope(pool: State<'_, DbPool>, id: i64) -> Result<Scope, String> {
    ScopeRepository::new(&pool)
        .get(ScopeId(id))
        .await
        .map_err(|e| e.to_string())
}
