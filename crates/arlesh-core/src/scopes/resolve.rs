//! Pure resolution of scopes to concrete half-open `[start, end)` datetime intervals,
//! plus activeness and interval-containment checks. No database access.

use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};
use serde::Serialize;

use super::key::ScopeKey;
use super::model::PartOfDay;

/// A resolved half-open datetime interval `[start, end)`.
pub type Bounds = (NaiveDateTime, NaiveDateTime);

/// Canonical serialization format for Exact-scope datetimes (minute precision, seconds zeroed).
pub const EXACT_DATETIME_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";

/// Builds a datetime at midnight of `date` offset by whole `hours` (0–23, wrapped).
fn at_hour(date: NaiveDate, hour: u32) -> NaiveDateTime {
    let time = NaiveTime::from_hms_opt(hour % 24, 0, 0).unwrap_or(NaiveTime::MIN);
    date.and_time(time)
}

/// The wall-clock hour the whole scope ladder turns over on. A Day runs 02:00 → 02:00, and
/// Season, Month and Week start and end on the same seam, so that every scope contains exactly
/// its own parts.
///
/// 02:00 is not a new seam: [`PartOfDay::band`] already runs Night 22:00–02:00 and Premorning
/// 02:00–06:00. A midnight boundary left a Day not containing its own Night — for the two hours
/// after midnight the part-of-day model said "still yesterday" and the Day scope said "already
/// today". Moving only the Day would have pushed the same contradiction up to the Week boundary,
/// so the whole ladder moves together: one rule, no special cases.
pub const DAY_BOUNDARY_HOUR: u32 = 2;

/// The instant the Day named by `date` begins — `date` at [`DAY_BOUNDARY_HOUR`].
pub fn day_boundary(date: NaiveDate) -> NaiveDateTime {
    at_hour(date, DAY_BOUNDARY_HOUR)
}

/// Resolves a canonical (Day/Week/Month/Season) scope from its inclusive date range to a
/// half-open datetime interval spanning whole days: `[start 02:00, (end + 1 day) 02:00)` — see
/// [`DAY_BOUNDARY_HOUR`].
pub fn canonical_bounds(start_date: NaiveDate, end_date: NaiveDate) -> Bounds {
    (
        day_boundary(start_date),
        day_boundary(end_date + Duration::days(1)),
    )
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

/// Resolves a scope against a given `now`. Pure: no database access, no clock read.
pub fn resolve(key: &ScopeKey, now: NaiveDateTime) -> ResolvedScope {
    let bounds = key.bounds();
    ResolvedScope {
        start: bounds.0.format(EXACT_DATETIME_FORMAT).to_string(),
        end: bounds.1.format(EXACT_DATETIME_FORMAT).to_string(),
        active: is_active_at(bounds, now),
    }
}

#[cfg(test)]
mod tests;
