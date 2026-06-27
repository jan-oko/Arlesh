//! Time scopes: Seasons, Months, Weeks, Days.

pub mod error;
pub mod model;

use chrono::{Datelike, Duration, NaiveDate};

use crate::database::DatabasePool;
use error::ScopeError;
use model::{Scope, ScopeId, ScopeKind};

/// Repository for scope get-or-create and lookup operations.
pub struct ScopeRepository<'a> {
    pool: &'a DatabasePool,
}

impl<'a> ScopeRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DatabasePool) -> Self {
        Self { pool }
    }

    /// Fetches a scope by id.
    pub async fn get(&self, id: ScopeId) -> Result<Scope, ScopeError> {
        sqlx::query_as::<_, Scope>("SELECT * FROM scopes WHERE id = ?")
            .bind(id.0)
            .fetch_optional(self.pool)
            .await?
            .ok_or(ScopeError::NotFound(id.0))
    }

    /// Returns the scope for `date` at the given `kind`, creating it if it doesn't exist yet.
    /// Containment parents (week/month/season) are recursively created first.
    pub fn get_or_create(
        &self,
        kind: ScopeKind,
        date: NaiveDate,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Scope, ScopeError>> + Send + '_>>
    {
        Box::pin(async move {
            let (start, end) = scope_bounds(kind.clone(), date);
            let start_str = start.to_string();
            let end_str = end.to_string();
            let label = scope_label(kind.clone(), date);

            if let Some(scope) = sqlx::query_as::<_, Scope>(
                "SELECT * FROM scopes WHERE kind = ? AND start_date = ?",
            )
            .bind(kind.as_str())
            .bind(&start_str)
            .fetch_optional(self.pool)
            .await?
            {
                return Ok(scope);
            }

            let (week_id, month_id, season_id) = self.containment_ids(kind.clone(), date).await?;

            let id = sqlx::query(
                "INSERT INTO scopes (kind, label, start_date, end_date, week_id, month_id, season_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(kind.as_str())
            .bind(&label)
            .bind(&start_str)
            .bind(&end_str)
            .bind(week_id)
            .bind(month_id)
            .bind(season_id)
            .execute(self.pool)
            .await?
            .last_insert_rowid();

            self.get(ScopeId(id)).await
        })
    }

    /// Computes the (week_id, month_id, season_id) for a scope, creating parents as needed.
    async fn containment_ids(
        &self,
        kind: ScopeKind,
        date: NaiveDate,
    ) -> Result<(Option<i64>, Option<i64>, Option<i64>), ScopeError> {
        match kind {
            ScopeKind::Day => {
                let week = self.get_or_create(ScopeKind::Week, date).await?;
                let month = self.get_or_create(ScopeKind::Month, date).await?;
                let season = self.get_or_create(ScopeKind::Season, date).await?;
                Ok((Some(week.id), Some(month.id), Some(season.id)))
            }
            ScopeKind::Month => {
                let season = self.get_or_create(ScopeKind::Season, date).await?;
                Ok((None, None, Some(season.id)))
            }
            ScopeKind::Week | ScopeKind::Season => Ok((None, None, None)),
        }
    }
}

/// Computes the inclusive [start, end] date range for a scope.
fn scope_bounds(kind: ScopeKind, date: NaiveDate) -> (NaiveDate, NaiveDate) {
    match kind {
        ScopeKind::Day => (date, date),
        ScopeKind::Week => {
            let days_since_sunday = date.weekday().num_days_from_sunday();
            let sunday = date - Duration::days(days_since_sunday as i64);
            let saturday = sunday + Duration::days(6);
            (sunday, saturday)
        }
        ScopeKind::Month => {
            let start = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap();
            let next_month = if date.month() == 12 {
                NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).unwrap()
            } else {
                NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1).unwrap()
            };
            let end = next_month - Duration::days(1);
            (start, end)
        }
        ScopeKind::Season => {
            let (season_month, year) = season_start_month_and_year(date);
            let start = NaiveDate::from_ymd_opt(year, season_month, 1).unwrap();
            // end_month is always 2, 5, 8, or 11 — never 12 — so end_month + 1 is always safe
            let end_month = ((season_month - 1 + 2) % 12) + 1;
            let end_year = if season_month + 2 > 12 { year + 1 } else { year };
            let after_end = NaiveDate::from_ymd_opt(end_year, end_month + 1, 1).unwrap();
            let end = after_end - Duration::days(1);
            (start, end)
        }
    }
}

/// Returns the human-readable label for a scope.
fn scope_label(kind: ScopeKind, date: NaiveDate) -> String {
    match kind {
        ScopeKind::Day => date.format("%Y-%m-%d").to_string(),
        ScopeKind::Week => {
            let week_num = week_number(date);
            format!("Week {} {}", week_num, date.year())
        }
        ScopeKind::Month => date.format("%B %Y").to_string(),
        ScopeKind::Season => {
            let (name, year) = season_name_and_year(date);
            format!("{} {}", name, year)
        }
    }
}

/// Returns the 1-based Sunday-to-Saturday week number for `date` within its year.
fn week_number(date: NaiveDate) -> u32 {
    let jan1 = NaiveDate::from_ymd_opt(date.year(), 1, 1).unwrap();
    let jan1_dow = jan1.weekday().num_days_from_sunday();
    let days_since_week1_sunday = date.ordinal0() + jan1_dow;
    days_since_week1_sunday / 7 + 1
}

/// Returns (season_name, display_year) for the season containing `date`.
fn season_name_and_year(date: NaiveDate) -> (&'static str, i32) {
    let month = date.month();
    match month {
        9..=11 => ("Autumn", date.year()),
        12 => ("Winter", date.year()),
        1..=2 => ("Winter", date.year() - 1),
        3..=5 => ("Spring", date.year()),
        6..=8 => ("Summer", date.year()),
        _ => unreachable!(),
    }
}

/// Returns (start_month, year) for the first month of the season containing `date`.
fn season_start_month_and_year(date: NaiveDate) -> (u32, i32) {
    let month = date.month();
    match month {
        9..=11 => (9, date.year()),
        12 => (12, date.year()),
        1..=2 => (12, date.year() - 1),
        3..=5 => (3, date.year()),
        6..=8 => (6, date.year()),
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    // --- scope_bounds: Day ---

    #[test]
    fn bounds_day_is_single_date() {
        let date = d(2026, 6, 20);
        assert_eq!(scope_bounds(ScopeKind::Day, date), (date, date));
    }

    // --- scope_bounds: Week ---

    #[test]
    fn bounds_week_saturday_starts_on_sunday() {
        // 2026-06-20 is Saturday
        let (start, end) = scope_bounds(ScopeKind::Week, d(2026, 6, 20));
        assert_eq!(start, d(2026, 6, 14));
        assert_eq!(end, d(2026, 6, 20));
    }

    #[test]
    fn bounds_week_wednesday_same_sunday_anchor() {
        // 2026-06-17 is Wednesday → same week as the Saturday above
        let (start, end) = scope_bounds(ScopeKind::Week, d(2026, 6, 17));
        assert_eq!(start, d(2026, 6, 14));
        assert_eq!(end, d(2026, 6, 20));
    }

    #[test]
    fn bounds_week_sunday_is_its_own_start() {
        let (start, _end) = scope_bounds(ScopeKind::Week, d(2026, 6, 14));
        assert_eq!(start, d(2026, 6, 14));
    }

    // --- scope_bounds: Month ---

    #[test]
    fn bounds_month_june_ends_on_30() {
        let (start, end) = scope_bounds(ScopeKind::Month, d(2026, 6, 15));
        assert_eq!(start, d(2026, 6, 1));
        assert_eq!(end, d(2026, 6, 30));
    }

    #[test]
    fn bounds_month_december_stays_within_year() {
        let (start, end) = scope_bounds(ScopeKind::Month, d(2026, 12, 15));
        assert_eq!(start, d(2026, 12, 1));
        assert_eq!(end, d(2026, 12, 31));
    }

    #[test]
    fn bounds_month_february_non_leap_ends_on_28() {
        let (start, end) = scope_bounds(ScopeKind::Month, d(2026, 2, 10));
        assert_eq!(start, d(2026, 2, 1));
        assert_eq!(end, d(2026, 2, 28));
    }

    #[test]
    fn bounds_month_february_leap_ends_on_29() {
        let (start, end) = scope_bounds(ScopeKind::Month, d(2024, 2, 15));
        assert_eq!(start, d(2024, 2, 1));
        assert_eq!(end, d(2024, 2, 29));
    }

    // --- scope_bounds: Season ---

    #[test]
    fn bounds_season_summer_june_to_august() {
        let (start, end) = scope_bounds(ScopeKind::Season, d(2026, 6, 20));
        assert_eq!(start, d(2026, 6, 1));
        assert_eq!(end, d(2026, 8, 31));
    }

    #[test]
    fn bounds_season_autumn_september_to_november() {
        let (start, end) = scope_bounds(ScopeKind::Season, d(2026, 10, 1));
        assert_eq!(start, d(2026, 9, 1));
        assert_eq!(end, d(2026, 11, 30));
    }

    #[test]
    fn bounds_season_spring_march_to_may() {
        let (start, end) = scope_bounds(ScopeKind::Season, d(2026, 4, 15));
        assert_eq!(start, d(2026, 3, 1));
        assert_eq!(end, d(2026, 5, 31));
    }

    #[test]
    fn bounds_season_winter_december_crosses_year() {
        let (start, end) = scope_bounds(ScopeKind::Season, d(2026, 12, 1));
        assert_eq!(start, d(2026, 12, 1));
        assert_eq!(end, d(2027, 2, 28));
    }

    #[test]
    fn bounds_season_winter_january_traces_to_december() {
        let (start, end) = scope_bounds(ScopeKind::Season, d(2027, 1, 15));
        assert_eq!(start, d(2026, 12, 1));
        assert_eq!(end, d(2027, 2, 28));
    }

    // --- scope_label ---

    #[test]
    fn label_day_formats_as_iso() {
        assert_eq!(scope_label(ScopeKind::Day, d(2026, 6, 20)), "2026-06-20");
    }

    #[test]
    fn label_month_is_full_name_and_year() {
        assert_eq!(scope_label(ScopeKind::Month, d(2026, 6, 15)), "June 2026");
    }

    #[test]
    fn label_season_summer() {
        assert_eq!(scope_label(ScopeKind::Season, d(2026, 7, 1)), "Summer 2026");
    }

    #[test]
    fn label_season_winter_december_uses_start_year() {
        assert_eq!(scope_label(ScopeKind::Season, d(2026, 12, 1)), "Winter 2026");
    }

    #[test]
    fn label_season_winter_january_uses_previous_year() {
        assert_eq!(scope_label(ScopeKind::Season, d(2027, 1, 15)), "Winter 2026");
    }

    #[test]
    fn label_week_contains_number_and_year() {
        let label = scope_label(ScopeKind::Week, d(2026, 6, 20));
        assert!(
            label.starts_with("Week ") && label.ends_with(" 2026"),
            "unexpected label: {label}"
        );
    }

    // --- week_number ---

    #[test]
    fn week_number_jan1_is_1() {
        assert_eq!(week_number(d(2026, 1, 1)), 1);
    }

    #[test]
    fn week_number_mid_year_in_expected_range() {
        let w = week_number(d(2026, 6, 20));
        assert!(w >= 24 && w <= 26, "week {w} out of expected range 24–26");
    }

    // --- season_name_and_year ---

    #[test]
    fn season_name_all_start_months() {
        assert_eq!(season_name_and_year(d(2026, 3, 1)), ("Spring", 2026));
        assert_eq!(season_name_and_year(d(2026, 6, 1)), ("Summer", 2026));
        assert_eq!(season_name_and_year(d(2026, 9, 1)), ("Autumn", 2026));
        assert_eq!(season_name_and_year(d(2026, 12, 1)), ("Winter", 2026));
        assert_eq!(season_name_and_year(d(2027, 1, 1)), ("Winter", 2026));
        assert_eq!(season_name_and_year(d(2026, 2, 28)), ("Winter", 2025));
    }

    // --- season_start_month_and_year ---

    #[test]
    fn season_start_december_stays_in_that_year() {
        assert_eq!(season_start_month_and_year(d(2026, 12, 15)), (12, 2026));
    }

    #[test]
    fn season_start_january_points_to_previous_december() {
        assert_eq!(season_start_month_and_year(d(2027, 1, 15)), (12, 2026));
    }

    #[test]
    fn season_start_june_is_6() {
        assert_eq!(season_start_month_and_year(d(2026, 6, 15)), (6, 2026));
    }

    #[test]
    fn season_start_september_is_9() {
        assert_eq!(season_start_month_and_year(d(2026, 10, 1)), (9, 2026));
    }
}
