//! Time scopes: Seasons, Months, Weeks, Days.

pub mod error;
pub mod model;

use chrono::{Datelike, Duration, NaiveDate};

use crate::db::DbPool;
use error::ScopeError;
use model::{Scope, ScopeId, ScopeKind};

/// Repository for scope get-or-create and lookup operations.
pub struct ScopeRepository<'a> {
    pool: &'a DbPool,
}

impl<'a> ScopeRepository<'a> {
    /// Creates a new repository backed by `pool`.
    pub fn new(pool: &'a DbPool) -> Self {
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
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Scope, ScopeError>> + Send + '_>> {
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
            let end_month = ((season_month - 1 + 2) % 12) + 1;
            let end_year = if season_month + 2 > 12 { year + 1 } else { year };
            let end_month_start =
                NaiveDate::from_ymd_opt(end_year, end_month, 1).unwrap();
            let after_end = if end_month == 12 {
                NaiveDate::from_ymd_opt(end_year + 1, 1, 1).unwrap()
            } else {
                NaiveDate::from_ymd_opt(end_year, end_month + 1, 1).unwrap()
            };
            let end = after_end - Duration::days(1);
            let _ = end_month_start;
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
        ScopeKind::Month => {
            date.format("%B %Y").to_string()
        }
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
    let m = date.month();
    match m {
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
    let m = date.month();
    match m {
        9..=11 => (9, date.year()),
        12 => (12, date.year()),
        1..=2 => (12, date.year() - 1),
        3..=5 => (3, date.year()),
        6..=8 => (6, date.year()),
        _ => unreachable!(),
    }
}
