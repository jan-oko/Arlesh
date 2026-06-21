//! Tauri commands for scope operations.

use chrono::NaiveDate;
use tauri::State;

use crate::{
    database::DatabasePool,
    scopes::{model::{Scope, ScopeId, ScopeKind}, ScopeRepository},
};

/// Gets or creates the scope for a date at a given granularity.
#[tauri::command]
pub async fn get_or_create_scope(
    pool: State<'_, DatabasePool>,
    kind: ScopeKind,
    date: String,
) -> Result<Scope, String> {
    let parsed_date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|error| format!("invalid date: {}", error))?;
    ScopeRepository::new(&pool)
        .get_or_create(kind, parsed_date)
        .await
        .map_err(|error| error.to_string())
}

/// Fetches a scope by id.
#[tauri::command]
pub async fn get_scope(pool: State<'_, DatabasePool>, id: i64) -> Result<Scope, String> {
    ScopeRepository::new(&pool)
        .get(ScopeId(id))
        .await
        .map_err(|error| error.to_string())
}
