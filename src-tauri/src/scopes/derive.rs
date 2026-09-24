//! The calendar conventions: which dates a canonical scope covers and what it is called.
//!
//! Pure arithmetic over a date. This is the only place the conventions live — a Week runs Sunday
//! to Saturday, Winter is December to February — and since scopes are derived rather than stored
//! (ADR 0009), changing any of them here reinterprets every past window at once.

use chrono::{Datelike, Duration, NaiveDate};

use super::model::ScopeKind;

/// The four calendar-aligned scope kinds that form the containment hierarchy and are named by a
/// single start date. Excludes Part-of-Day and Exact, which carry more than a date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum CanonicalKind {
    Season,
    Month,
    Week,
    Day,
}

impl CanonicalKind {
    /// Narrows a `ScopeKind` to a `CanonicalKind`, or `None` for Part-of-Day / Exact.
    pub(super) fn from_scope_kind(kind: ScopeKind) -> Option<Self> {
        match kind {
            ScopeKind::Season => Some(Self::Season),
            ScopeKind::Month => Some(Self::Month),
            ScopeKind::Week => Some(Self::Week),
            ScopeKind::Day => Some(Self::Day),
            ScopeKind::PartOfDay | ScopeKind::Exact => None,
        }
    }
}

/// The first day of the month holding `date`.
fn first_of_month(date: NaiveDate) -> NaiveDate {
    date - Duration::days(i64::from(date.day0()))
}

/// The first day of the month after the one holding `date`.
fn first_of_next_month(date: NaiveDate) -> NaiveDate {
    // The 28th plus four days is always in the next month, whatever this one's length.
    let late = first_of_month(date) + Duration::days(27);
    first_of_month(late + Duration::days(4))
}

/// Computes the inclusive `[start, end]` date range of the canonical scope holding `date`.
pub(super) fn scope_dates(kind: CanonicalKind, date: NaiveDate) -> (NaiveDate, NaiveDate) {
    match kind {
        CanonicalKind::Day => (date, date),
        CanonicalKind::Week => {
            let days_since_sunday = date.weekday().num_days_from_sunday();
            let sunday = date - Duration::days(i64::from(days_since_sunday));
            (sunday, sunday + Duration::days(6))
        }
        CanonicalKind::Month => (
            first_of_month(date),
            first_of_next_month(date) - Duration::days(1),
        ),
        CanonicalKind::Season => {
            // A season is three months starting in Dec, Mar, Jun or Sep: step back to its first.
            let months_into_season = (date.month0() + 1) % 3;
            let mut start = first_of_month(date);
            for _ in 0..months_into_season {
                start = first_of_month(start - Duration::days(1));
            }
            let mut after = start;
            for _ in 0..3 {
                after = first_of_next_month(after);
            }
            (start, after - Duration::days(1))
        }
    }
}

/// Returns the human-readable label for the canonical scope starting on `start`.
pub(super) fn scope_label(kind: CanonicalKind, start: NaiveDate) -> String {
    match kind {
        CanonicalKind::Day => start.format("%Y-%m-%d").to_string(),
        CanonicalKind::Week => format!("Week {} {}", week_number(start), start.year()),
        CanonicalKind::Month => start.format("%B %Y").to_string(),
        CanonicalKind::Season => {
            let (name, year) = season_name_and_year(start);
            format!("{name} {year}")
        }
    }
}

/// Returns the 1-based Sunday-to-Saturday week number for `date` within its year.
pub(super) fn week_number(date: NaiveDate) -> u32 {
    let days_to_first_sunday = date
        .with_ordinal0(0)
        .map_or(0, |jan1| jan1.weekday().num_days_from_sunday());
    (date.ordinal0() + days_to_first_sunday) / 7 + 1
}

/// Returns (season_name, display_year) for the season containing `date`. A Winter is labelled
/// with the year its December falls in.
pub(super) fn season_name_and_year(date: NaiveDate) -> (&'static str, i32) {
    match date.month() {
        3..=5 => ("Spring", date.year()),
        6..=8 => ("Summer", date.year()),
        9..=11 => ("Autumn", date.year()),
        12 => ("Winter", date.year()),
        _ => ("Winter", date.year() - 1),
    }
}

#[cfg(test)]
mod tests;
