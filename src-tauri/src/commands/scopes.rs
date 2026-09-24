//! Tauri commands for scopes.
//!
//! Every one of them is pure: a scope is derived from its value key (ADR 0009), so none touches
//! the database.

use chrono::{Local, NaiveDate, NaiveDateTime};

use crate::{
    error::WireError,
    scopes::{
        key::ScopeKey,
        model::{PartOfDay, Scope, ScopeKind},
        resolve::{resolve, ResolvedScope, EXACT_DATETIME_FORMAT},
    },
};

/// Parses a wire `YYYY-MM-DD` date.
fn parse_date(date: &str) -> Result<NaiveDate, WireError> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|error| WireError::invalid_request(format!("invalid date: {error}")))
}

/// The Season, Month, Week or Day of `kind` holding `date` (`YYYY-MM-DD`).
#[tauri::command]
pub fn scope_containing(kind: ScopeKind, date: String) -> Result<Scope, WireError> {
    Scope::containing(kind, parse_date(&date)?).map_err(WireError::from_error)
}

/// The Part-of-Day scope for a date (`YYYY-MM-DD`) and band.
#[tauri::command]
pub fn part_scope(date: String, part: PartOfDay) -> Result<Scope, WireError> {
    Ok(Scope::part(parse_date(&date)?, part))
}

/// The Exact scope for an arbitrary `[start, end)` datetime window (minute precision, ISO 8601
/// `YYYY-MM-DDTHH:MM:SS`).
#[tauri::command]
pub fn exact_scope(start: String, end: String) -> Result<Scope, WireError> {
    let parse = |value: &str| {
        NaiveDateTime::parse_from_str(value, EXACT_DATETIME_FORMAT).map_err(|error| {
            WireError::invalid_request(format!("invalid datetime {value:?}: {error}"))
        })
    };
    Scope::exact(parse(&start)?, parse(&end)?).map_err(WireError::from_error)
}

/// The scope a key names, with its label and dates.
#[tauri::command]
pub fn get_scope(id: ScopeKey) -> Scope {
    id.scope()
}

/// Resolves a scope to its datetime window and current active state.
#[tauri::command]
pub fn resolve_scope(id: ScopeKey) -> ResolvedScope {
    resolve(&id, Local::now().naive_local())
}

#[cfg(test)]
mod tests;
