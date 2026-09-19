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
#[cfg_attr(coverage_nightly, coverage(off))]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }
    fn dt(y: i32, m: u32, day: u32, h: u32, min: u32) -> NaiveDateTime {
        d(y, m, day).and_hms_opt(h, min, 0).unwrap()
    }

    #[test]
    fn canonical_day_spans_one_full_day_half_open() {
        let bounds = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
        assert_eq!(bounds.0, dt(2026, 6, 20, 0, 0));
        assert_eq!(bounds.1, dt(2026, 6, 21, 0, 0));
    }

    #[test]
    fn canonical_week_ends_at_midnight_after_last_day() {
        let bounds = canonical_bounds(d(2026, 6, 14), d(2026, 6, 20));
        assert_eq!(bounds.0, dt(2026, 6, 14, 0, 0));
        assert_eq!(bounds.1, dt(2026, 6, 21, 0, 0));
    }

    #[test]
    fn part_of_day_morning_is_06_to_12_same_day() {
        let bounds = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Morning);
        assert_eq!(bounds.0, dt(2026, 6, 20, 6, 0));
        assert_eq!(bounds.1, dt(2026, 6, 20, 12, 0));
    }

    #[test]
    fn part_of_day_night_wraps_to_next_day_at_02() {
        let bounds = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Night);
        assert_eq!(bounds.0, dt(2026, 6, 20, 22, 0));
        assert_eq!(bounds.1, dt(2026, 6, 21, 2, 0));
    }

    #[test]
    fn part_of_day_premorning_is_02_to_06() {
        let bounds = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Premorning);
        assert_eq!(bounds.0, dt(2026, 6, 20, 2, 0));
        assert_eq!(bounds.1, dt(2026, 6, 20, 6, 0));
    }

    #[test]
    fn active_includes_start_excludes_end() {
        let bounds = (dt(2026, 6, 20, 0, 0), dt(2026, 6, 21, 0, 0));
        assert!(is_active_at(bounds, dt(2026, 6, 20, 0, 0)));
        assert!(is_active_at(bounds, dt(2026, 6, 20, 23, 59)));
        assert!(!is_active_at(bounds, dt(2026, 6, 21, 0, 0)));
        assert!(!is_active_at(bounds, dt(2026, 6, 19, 23, 59)));
    }

    #[test]
    fn a_night_instant_after_midnight_is_active_in_the_starting_days_night() {
        let night = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Night);
        assert!(is_active_at(night, dt(2026, 6, 21, 1, 0)));
        assert!(!is_active_at(night, dt(2026, 6, 21, 2, 0)));
    }

    #[test]
    fn containment_is_inclusive_at_both_edges() {
        let week = canonical_bounds(d(2026, 6, 14), d(2026, 6, 20));
        let day = canonical_bounds(d(2026, 6, 17), d(2026, 6, 17));
        assert!(interval_contains(week, day));
        assert!(interval_contains(week, week));
    }

    #[test]
    fn containment_rejects_partial_overlap_and_supersets() {
        let week = canonical_bounds(d(2026, 6, 14), d(2026, 6, 20));
        let next_day = canonical_bounds(d(2026, 6, 21), d(2026, 6, 21));
        let month = canonical_bounds(d(2026, 6, 1), d(2026, 6, 30));
        assert!(!interval_contains(week, next_day));
        assert!(!interval_contains(week, month));
    }

    #[test]
    fn a_part_of_day_is_contained_in_its_day() {
        let day = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
        let morning = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Morning);
        assert!(interval_contains(day, morning));
    }

    #[test]
    fn night_is_not_contained_in_its_starting_day() {
        // Night runs into the next day, so it is NOT a subset of the day it starts on.
        let day = canonical_bounds(d(2026, 6, 20), d(2026, 6, 20));
        let night = part_of_day_bounds(d(2026, 6, 20), PartOfDay::Night);
        assert!(!interval_contains(day, night));
    }

    fn mk_scope(kind: &str) -> Scope {
        Scope {
            id: 1,
            kind: kind.to_string(),
            label: "test".to_string(),
            start_date: "2026-06-20".to_string(),
            end_date: "2026-06-20".to_string(),
            week_id: None,
            month_id: None,
            season_id: None,
            day_id: None,
            part: None,
            start_datetime: None,
            end_datetime: None,
        }
    }

    #[test]
    fn row_resolution_canonical_day() {
        let scope = mk_scope("day");
        assert_eq!(
            scope_bounds(&scope).unwrap(),
            (dt(2026, 6, 20, 0, 0), dt(2026, 6, 21, 0, 0))
        );
    }

    #[test]
    fn row_resolution_part_of_day_night() {
        let mut scope = mk_scope("part_of_day");
        scope.part = Some("night".to_string());
        assert_eq!(
            scope_bounds(&scope).unwrap(),
            (dt(2026, 6, 20, 22, 0), dt(2026, 6, 21, 2, 0))
        );
    }

    #[test]
    fn row_resolution_exact_uses_stored_datetimes() {
        let mut scope = mk_scope("exact");
        scope.start_datetime = Some("2026-06-20T09:30:00".to_string());
        scope.end_datetime = Some("2026-06-22T14:00:00".to_string());
        assert_eq!(
            scope_bounds(&scope).unwrap(),
            (dt(2026, 6, 20, 9, 30), dt(2026, 6, 22, 14, 0))
        );
    }

    #[test]
    fn row_resolution_active_check_on_a_row() {
        let scope = mk_scope("day");
        assert!(scope_is_active(&scope, dt(2026, 6, 20, 10, 0)).unwrap());
        assert!(!scope_is_active(&scope, dt(2026, 6, 21, 10, 0)).unwrap());
    }

    #[test]
    fn row_resolution_rejects_unknown_kind_and_missing_part() {
        assert!(scope_bounds(&mk_scope("decade")).is_err());
        assert!(scope_bounds(&mk_scope("part_of_day")).is_err()); // part is None
        let mut exact = mk_scope("exact");
        exact.start_datetime = Some("2026-06-20T09:30:00".to_string()); // end missing
        assert!(scope_bounds(&exact).is_err());
    }
}
