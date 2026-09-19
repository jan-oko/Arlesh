//! Tauri commands for scope operations.

use chrono::{Local, NaiveDate, NaiveDateTime};
use tauri::State;

use crate::{
    database::session::SessionFactory,
    error::WireError,
    scopes::{
        model::{PartOfDay, Scope, ScopeId, ScopeKind},
        resolve::{resolve, ResolvedScope, EXACT_DATETIME_FORMAT},
    },
};

/// Gets or creates the scope for a date at a given granularity.
///
/// Multi-statement (containment parents may be created recursively), so it runs on a
/// transactional session: without the [`commit`](crate::database::session::Db::commit) below,
/// sqlx rolls the whole creation back when the session drops.
#[tauri::command]
pub async fn get_or_create_scope(
    factory: State<'_, SessionFactory>,
    kind: ScopeKind,
    date: String,
) -> Result<Scope, WireError> {
    let parsed_date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|error| WireError::invalid_request(format!("invalid date: {error}")))?;
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let scope = db
        .scopes()
        .get_or_create(kind, parsed_date)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(scope)
}

/// Gets or creates the Part-of-Day scope for a date and band.
///
/// Multi-statement (the Day and its own parents may be created recursively), so it runs on a
/// transactional session; see [`get_or_create_scope`].
#[tauri::command]
pub async fn get_or_create_part_scope(
    factory: State<'_, SessionFactory>,
    date: String,
    part: PartOfDay,
) -> Result<Scope, WireError> {
    let parsed_date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|error| WireError::invalid_request(format!("invalid date: {error}")))?;
    let mut db = factory.begin().await.map_err(WireError::from_error)?;
    let scope = db
        .scopes()
        .get_or_create_part(parsed_date, part)
        .await
        .map_err(WireError::from_error)?;
    db.commit().await.map_err(WireError::from_error)?;
    Ok(scope)
}

/// Gets or creates the Exact scope for an arbitrary `[start, end)` datetime window (minute
/// precision, ISO 8601 `YYYY-MM-DDTHH:MM:SS`).
///
/// Exact scopes have no containment parents to create, so this is a single-statement write on a
/// pooled session — SQLite gives it statement-level atomicity on its own.
#[tauri::command]
pub async fn get_or_create_exact_scope(
    factory: State<'_, SessionFactory>,
    start: String,
    end: String,
) -> Result<Scope, WireError> {
    let parse = |value: &str| {
        NaiveDateTime::parse_from_str(value, EXACT_DATETIME_FORMAT).map_err(|error| {
            WireError::invalid_request(format!("invalid datetime {value:?}: {error}"))
        })
    };
    let start = parse(&start)?;
    let end = parse(&end)?;
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.scopes()
        .get_or_create_exact(start, end)
        .await
        .map_err(WireError::from_error)
}

/// Fetches a scope by id.
#[tauri::command]
pub async fn get_scope(factory: State<'_, SessionFactory>, id: i64) -> Result<Scope, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    db.scopes()
        .get(ScopeId(id))
        .await
        .map_err(WireError::from_error)
}

/// Resolves a scope to its datetime window and current active state.
#[tauri::command]
pub async fn resolve_scope(
    factory: State<'_, SessionFactory>,
    id: i64,
) -> Result<ResolvedScope, WireError> {
    let mut db = factory.connect().await.map_err(WireError::from_error)?;
    let scope = db
        .scopes()
        .get(ScopeId(id))
        .await
        .map_err(WireError::from_error)?;
    resolve(&scope, Local::now().naive_local()).map_err(WireError::from_error)
}

#[cfg(test)]
mod tests;
