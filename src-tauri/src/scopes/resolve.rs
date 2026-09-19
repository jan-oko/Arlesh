//! Pure resolution of scopes to concrete half-open `[start, end)` datetime intervals,
//! plus activeness and interval-containment checks. No database access.

use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};
use serde::Serialize;

use super::error::ScopeError;
use super::model::{PartOfDay, Scope, ScopeKind};

/// A resolved half-open datetime interval `[start, end)`.
pub type Bounds = (NaiveDateTime, NaiveDateTime);

/// Canonical serialization format for Exact-scope datetimes (minute precision, seconds zeroed).
pub const EXACT_DATETIME_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";

/// Builds a datetime at midnight of `date` offset by whole `hours` (0–23, wrapped).
fn at_hour(date: NaiveDate, hour: u32) -> NaiveDateTime {
    let time = NaiveTime::from_hms_opt(hour % 24, 0, 0).unwrap_or(NaiveTime::MIN);
    date.and_time(time)
}

/// Resolves a canonical (Day/Week/Month/Season) scope from its inclusive date range to a
/// half-open datetime interval spanning whole days: `[start 00:00, (end + 1 day) 00:00)`.
pub fn canonical_bounds(start_date: NaiveDate, end_date: NaiveDate) -> Bounds {
    let start = start_date.and_time(NaiveTime::MIN);
    let end = (end_date + Duration::days(1)).and_time(NaiveTime::MIN);
    (start, end)
}

/// Resolves a Part-of-Day scope to its half-open datetime interval. `start_date` is the day
/// the part begins on; Night (22:00–02:00) ends at 02:00 of the following day.
pub fn part_of_day_bounds(start_date: NaiveDate, part: PartOfDay) -> Bounds {
    let (start_hour, end_hour) = part.band();
    let start = at_hour(start_date, start_hour);
    let end = if start_hour < end_hour {
        at_hour(start_date, end_hour)
    } else {
        // Wraps past midnight (Night): end falls on the next day.
        at_hour(start_date + Duration::days(1), end_hour)
    };
    (start, end)
}

/// Returns true when `now` lies within the half-open interval `[start, end)`.
pub fn is_active_at(bounds: Bounds, now: NaiveDateTime) -> bool {
    bounds.0 <= now && now < bounds.1
}

/// Returns true when `inner` is wholly contained within `outer` (interval containment).
pub fn interval_contains(outer: Bounds, inner: Bounds) -> bool {
    outer.0 <= inner.0 && inner.1 <= outer.1
}

/// Parses an Exact-scope datetime string in [`EXACT_DATETIME_FORMAT`].
pub fn parse_exact_datetime(id: i64, value: Option<&str>) -> Result<NaiveDateTime, ScopeError> {
    let raw = value.ok_or_else(|| ScopeError::Malformed(id, "missing exact datetime".into()))?;
    NaiveDateTime::parse_from_str(raw, EXACT_DATETIME_FORMAT)
        .map_err(|e| ScopeError::Malformed(id, format!("bad datetime {raw:?}: {e}")))
}

fn parse_date(id: i64, value: &str) -> Result<NaiveDate, ScopeError> {
    value
        .parse::<NaiveDate>()
        .map_err(|e| ScopeError::Malformed(id, format!("bad date {value:?}: {e}")))
}

/// Resolves any scope row to its half-open `[start, end)` datetime interval, dispatching on kind.
pub fn scope_bounds(scope: &Scope) -> Result<Bounds, ScopeError> {
    let kind = ScopeKind::parse_db(&scope.kind)
        .ok_or_else(|| ScopeError::Malformed(scope.id, format!("unknown kind {:?}", scope.kind)))?;
    match kind {
        ScopeKind::Season | ScopeKind::Month | ScopeKind::Week | ScopeKind::Day => {
            let start = parse_date(scope.id, &scope.start_date)?;
            let end = parse_date(scope.id, &scope.end_date)?;
            Ok(canonical_bounds(start, end))
        }
        ScopeKind::PartOfDay => {
            let start = parse_date(scope.id, &scope.start_date)?;
            let part = scope
                .part
                .as_deref()
                .and_then(PartOfDay::parse_db)
                .ok_or_else(|| ScopeError::Malformed(scope.id, "missing/invalid part".into()))?;
            Ok(part_of_day_bounds(start, part))
        }
        ScopeKind::Exact => {
            let start = parse_exact_datetime(scope.id, scope.start_datetime.as_deref())?;
            let end = parse_exact_datetime(scope.id, scope.end_datetime.as_deref())?;
            Ok((start, end))
        }
    }
}

/// Returns true when `scope` contains `now` in its resolved interval.
pub fn scope_is_active(scope: &Scope, now: NaiveDateTime) -> Result<bool, ScopeError> {
    Ok(is_active_at(scope_bounds(scope)?, now))
}

/// A scope resolved to its half-open `[start, end)` datetime window, with whether it is currently
/// active (contains `now`). Datetimes are ISO 8601, second precision.
///
/// Lives here rather than beside a command because both adapters that expose scopes — the Tauri
/// commands and the MCP server — return this same shape, and neither is below the other.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ResolvedScope {
    /// Inclusive window start.
    pub start: String,
    /// Exclusive window end.
    pub end: String,
    /// Whether `now` falls within `[start, end)`.
    pub active: bool,
}

/// Resolves a scope row against a given `now`. Pure: no database access, no clock read.
pub fn resolve(scope: &Scope, now: NaiveDateTime) -> Result<ResolvedScope, ScopeError> {
    let bounds = scope_bounds(scope)?;
    Ok(ResolvedScope {
        start: bounds.0.format(EXACT_DATETIME_FORMAT).to_string(),
        end: bounds.1.format(EXACT_DATETIME_FORMAT).to_string(),
        active: is_active_at(bounds, now),
    })
}

#[cfg(test)]
mod tests;
