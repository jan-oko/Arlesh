//! Tauri commands for scope operations.

use chrono::{Local, NaiveDate, NaiveDateTime};
use serde::Serialize;
use tauri::State;

use crate::{
    database::DatabasePool,
    scopes::{
        error::ScopeError,
        model::{PartOfDay, Scope, ScopeId, ScopeKind},
        resolve::{is_active_at, scope_bounds, EXACT_DATETIME_FORMAT},
        ScopeRepository,
    },
};

/// A scope resolved to its half-open `[start, end)` datetime window, with whether it is currently
/// active (contains the local wall-clock now). Datetimes are ISO 8601, second precision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ResolvedScope {
    /// Inclusive window start.
    pub start: String,
    /// Exclusive window end.
    pub end: String,
    /// Whether `now` falls within `[start, end)`.
    pub active: bool,
}

/// Pure core of [`resolve_scope`]: resolves a scope row against a given `now`.
fn resolve(scope: &Scope, now: NaiveDateTime) -> Result<ResolvedScope, ScopeError> {
    let bounds = scope_bounds(scope)?;
    Ok(ResolvedScope {
        start: bounds.0.format(EXACT_DATETIME_FORMAT).to_string(),
        end: bounds.1.format(EXACT_DATETIME_FORMAT).to_string(),
        active: is_active_at(bounds, now),
    })
}

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

/// Gets or creates the Part-of-Day scope for a date and band.
#[tauri::command]
pub async fn get_or_create_part_scope(
    pool: State<'_, DatabasePool>,
    date: String,
    part: PartOfDay,
) -> Result<Scope, String> {
    let parsed_date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|error| format!("invalid date: {}", error))?;
    ScopeRepository::new(&pool)
        .get_or_create_part(parsed_date, part)
        .await
        .map_err(|error| error.to_string())
}

/// Gets or creates the Exact scope for an arbitrary `[start, end)` datetime window (minute
/// precision, ISO 8601 `YYYY-MM-DDTHH:MM:SS`).
#[tauri::command]
pub async fn get_or_create_exact_scope(
    pool: State<'_, DatabasePool>,
    start: String,
    end: String,
) -> Result<Scope, String> {
    let parse = |value: &str| {
        NaiveDateTime::parse_from_str(value, EXACT_DATETIME_FORMAT)
            .map_err(|error| format!("invalid datetime {value:?}: {error}"))
    };
    let start = parse(&start)?;
    let end = parse(&end)?;
    ScopeRepository::new(&pool)
        .get_or_create_exact(start, end)
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

/// Resolves a scope to its datetime window and current active state.
#[tauri::command]
pub async fn resolve_scope(
    pool: State<'_, DatabasePool>,
    id: i64,
) -> Result<ResolvedScope, String> {
    let scope = ScopeRepository::new(&pool)
        .get(ScopeId(id))
        .await
        .map_err(|error| error.to_string())?;
    resolve(&scope, Local::now().naive_local()).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(kind: &str, start: &str, end: &str) -> Scope {
        Scope {
            id: 1,
            kind: kind.to_string(),
            label: "test".to_string(),
            start_date: start.to_string(),
            end_date: end.to_string(),
            week_id: None,
            month_id: None,
            season_id: None,
            day_id: None,
            part: None,
            start_datetime: None,
            end_datetime: None,
        }
    }

    fn at(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, EXACT_DATETIME_FORMAT).unwrap()
    }

    #[test]
    fn resolve_reports_iso_half_open_bounds() {
        let resolved = resolve(&scope("day", "2026-06-20", "2026-06-20"), at("2026-06-20T09:00:00"))
            .unwrap();
        assert_eq!(resolved.start, "2026-06-20T00:00:00");
        assert_eq!(resolved.end, "2026-06-21T00:00:00");
    }

    #[test]
    fn resolve_marks_active_only_inside_the_window() {
        let day = scope("day", "2026-06-20", "2026-06-20");
        assert!(resolve(&day, at("2026-06-20T00:00:00")).unwrap().active);
        assert!(resolve(&day, at("2026-06-20T23:59:00")).unwrap().active);
        assert!(!resolve(&day, at("2026-06-21T00:00:00")).unwrap().active);
        assert!(!resolve(&day, at("2026-06-19T23:59:00")).unwrap().active);
    }

    #[test]
    fn resolve_propagates_malformed_scope_errors() {
        assert!(resolve(&scope("decade", "2026-06-20", "2026-06-20"), at("2026-06-20T09:00:00"))
            .is_err());
    }
}
