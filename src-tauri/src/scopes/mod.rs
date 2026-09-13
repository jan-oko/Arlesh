//! Time scopes: Seasons, Months, Weeks, Days.

pub mod error;
pub mod model;
pub mod resolve;

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};

use crate::database::DatabasePool;
use error::ScopeError;
use model::{PartOfDay, Scope, ScopeId, ScopeKind};
use resolve::EXACT_DATETIME_FORMAT;

/// The four calendar-aligned scope kinds that form the containment hierarchy and are
/// created from a single anchoring date. Excludes Part-of-Day and Exact, which have
/// dedicated constructors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CanonicalKind {
    Season,
    Month,
    Week,
    Day,
}

impl CanonicalKind {
    /// Narrows a `ScopeKind` to a `CanonicalKind`, or `None` for Part-of-Day / Exact.
    fn from_scope_kind(kind: ScopeKind) -> Option<Self> {
        match kind {
            ScopeKind::Season => Some(Self::Season),
            ScopeKind::Month => Some(Self::Month),
            ScopeKind::Week => Some(Self::Week),
            ScopeKind::Day => Some(Self::Day),
            ScopeKind::PartOfDay | ScopeKind::Exact => None,
        }
    }

    /// Widens back to the public `ScopeKind`.
    fn as_scope_kind(self) -> ScopeKind {
        match self {
            Self::Season => ScopeKind::Season,
            Self::Month => ScopeKind::Month,
            Self::Week => ScopeKind::Week,
            Self::Day => ScopeKind::Day,
        }
    }

    /// The database string representation.
    fn as_str(self) -> &'static str {
        self.as_scope_kind().as_str()
    }
}

/// Reads and writes seasons, months, weeks and days on a session's connection.
///
/// Obtained as `db.scopes()` and used inline; see [`Db`](crate::database::session::Db) for
/// the borrow rules and for where an operation belongs.
pub struct ScopeOperator<'session> {
    /// The session's connection, borrowed for the duration of this operator's life.
    connection: &'session mut sqlx::SqliteConnection,
}

impl<'session> ScopeOperator<'session> {
    /// Wraps the connection a session is lending.
    pub(crate) fn new(connection: &'session mut sqlx::SqliteConnection) -> Self {
        Self { connection }
    }

    /// Fetches a scope by id.
    pub async fn get(&mut self, id: ScopeId) -> Result<Scope, ScopeError> {
        sqlx::query_as::<_, Scope>("SELECT * FROM scopes WHERE id = ?")
            .bind(id.0)
            .fetch_optional(&mut *self.connection)
            .await?
            .ok_or(ScopeError::NotFound(id.0))
    }

    /// Returns the scope for `date` at the given `kind`, creating it if it doesn't exist yet.
    /// Containment parents (week/month/season) are recursively created first.
    ///
    /// Multi-statement — a lookup, the recursive creation of any missing containment parents, and
    /// an insert of the scope itself — and so **not atomic on its own**. It opens no transaction:
    /// per ADR-0004 only the outermost caller decides the boundary.
    ///
    /// ```no_run
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # use arlesh_lib::scopes::error::ScopeError;
    /// # use arlesh_lib::scopes::model::ScopeKind;
    /// # use chrono::NaiveDate;
    /// # async fn get_or_create(factory: &SessionFactory, date: NaiveDate) -> Result<(), ScopeError> {
    /// let mut db = factory.begin().await?;
    /// db.scopes().get_or_create(ScopeKind::Day, date).await?;
    /// db.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    pub fn get_or_create(
        &mut self,
        kind: ScopeKind,
        date: NaiveDate,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Scope, ScopeError>> + Send + '_>>
    {
        Box::pin(async move {
            let canonical = CanonicalKind::from_scope_kind(kind)
                .ok_or(ScopeError::UnsupportedKind(kind.as_str()))?;
            let (start, end) = scope_bounds(canonical, date);
            let start_str = start.to_string();
            let end_str = end.to_string();
            let label = scope_label(canonical, date);

            if let Some(scope) = sqlx::query_as::<_, Scope>(
                "SELECT * FROM scopes WHERE kind = ? AND start_date = ?",
            )
            .bind(canonical.as_str())
            .bind(&start_str)
            .fetch_optional(&mut *self.connection)
            .await?
            {
                return Ok(scope);
            }

            let (week_id, month_id, season_id) = self.containment_ids(canonical, date).await?;

            let id = sqlx::query(
                "INSERT INTO scopes (kind, label, start_date, end_date, week_id, month_id, season_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(canonical.as_str())
            .bind(&label)
            .bind(&start_str)
            .bind(&end_str)
            .bind(week_id)
            .bind(month_id)
            .bind(season_id)
            .execute(&mut *self.connection)
            .await?
            .last_insert_rowid();

            self.get(ScopeId(id)).await
        })
    }

    /// Computes the (week_id, month_id, season_id) for a scope, creating parents as needed.
    async fn containment_ids(
        &mut self,
        kind: CanonicalKind,
        date: NaiveDate,
    ) -> Result<(Option<i64>, Option<i64>, Option<i64>), ScopeError> {
        match kind {
            CanonicalKind::Day => {
                let week = self.get_or_create(ScopeKind::Week, date).await?;
                let month = self.get_or_create(ScopeKind::Month, date).await?;
                let season = self.get_or_create(ScopeKind::Season, date).await?;
                Ok((Some(week.id), Some(month.id), Some(season.id)))
            }
            CanonicalKind::Month => {
                let season = self.get_or_create(ScopeKind::Season, date).await?;
                Ok((None, None, Some(season.id)))
            }
            CanonicalKind::Week | CanonicalKind::Season => Ok((None, None, None)),
        }
    }

    /// Returns the Part-of-Day scope for `date` + `part`, creating it (and its Day, Week,
    /// Month, Season parents) if absent. The scope inherits its Day's containment ids.
    ///
    /// Multi-statement — the recursive creation of the Day (and its own parents) plus an insert
    /// of the part scope — and so **not atomic on its own**. It opens no transaction: per
    /// ADR-0004 only the outermost caller decides the boundary.
    ///
    /// ```no_run
    /// # use arlesh_lib::database::session::SessionFactory;
    /// # use arlesh_lib::scopes::error::ScopeError;
    /// # use arlesh_lib::scopes::model::PartOfDay;
    /// # use chrono::NaiveDate;
    /// # async fn get_or_create_part(factory: &SessionFactory, date: NaiveDate) -> Result<(), ScopeError> {
    /// let mut db = factory.begin().await?;
    /// db.scopes().get_or_create_part(date, PartOfDay::Morning).await?;
    /// db.commit().await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_or_create_part(
        &mut self,
        date: NaiveDate,
        part: PartOfDay,
    ) -> Result<Scope, ScopeError> {
        let start_str = date.to_string();
        if let Some(scope) = sqlx::query_as::<_, Scope>(
            "SELECT * FROM scopes WHERE kind = 'part_of_day' AND start_date = ? AND part = ?",
        )
        .bind(&start_str)
        .bind(part.as_str())
        .fetch_optional(&mut *self.connection)
        .await?
        {
            return Ok(scope);
        }

        let day = self.get_or_create(ScopeKind::Day, date).await?;
        let (start_hour, end_hour) = part.band();
        let end_date = if start_hour < end_hour {
            date
        } else {
            date + Duration::days(1)
        };
        let label = format!("{} {}", day.label, part.as_str());

        let id = sqlx::query(
            "INSERT INTO scopes
                (kind, label, start_date, end_date, week_id, month_id, season_id, day_id, part)
             VALUES ('part_of_day', ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&label)
        .bind(&start_str)
        .bind(end_date.to_string())
        .bind(day.week_id)
        .bind(day.month_id)
        .bind(day.season_id)
        .bind(day.id)
        .bind(part.as_str())
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();

        self.get(ScopeId(id)).await
    }

    /// Returns the Exact scope for the half-open `[start, end)` datetime window, creating it
    /// if absent. Exact scopes lie outside the canonical hierarchy and carry no containment ids.
    pub async fn get_or_create_exact(
        &mut self,
        start: NaiveDateTime,
        end: NaiveDateTime,
    ) -> Result<Scope, ScopeError> {
        let start_dt = start.format(EXACT_DATETIME_FORMAT).to_string();
        let end_dt = end.format(EXACT_DATETIME_FORMAT).to_string();
        if let Some(scope) = sqlx::query_as::<_, Scope>(
            "SELECT * FROM scopes WHERE kind = 'exact' AND start_datetime = ? AND end_datetime = ?",
        )
        .bind(&start_dt)
        .bind(&end_dt)
        .fetch_optional(&mut *self.connection)
        .await?
        {
            return Ok(scope);
        }

        let label = format!("{start_dt} – {end_dt}");
        let id = sqlx::query(
            "INSERT INTO scopes (kind, label, start_date, end_date, start_datetime, end_datetime)
             VALUES ('exact', ?, ?, ?, ?, ?)",
        )
        .bind(&label)
        .bind(start.date().to_string())
        .bind(end.date().to_string())
        .bind(&start_dt)
        .bind(&end_dt)
        .execute(&mut *self.connection)
        .await?
        .last_insert_rowid();

        self.get(ScopeId(id)).await
    }
}

/// Repository for scope get-or-create and lookup operations.
///
/// Transitional: the SQL now lives on [`ScopeOperator`], and every method here checks a
/// connection out of the pool and delegates to it, so repository and operator cannot drift while
/// callers move over. None of these methods was ever transactional at the repository level, so
/// the shim does not introduce one either. `tasks/scope_rules.rs` stopped calling it in Task 2.2
/// Step 3; the struct goes away once its last source caller, `FlowRepository` (`flows/mod.rs`),
/// is migrated in Step 4 and `tests/scopes.rs` and `tests/flows.rs` follow.
///
/// The methods below carry no `tracing::instrument`: each delegates to an operator method, and
/// the operator methods themselves carry none either (matching the original repository, which
/// had no instrumentation).
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
        let mut connection = self.pool.acquire().await?;
        ScopeOperator::new(&mut connection).get(id).await
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
            let mut connection = self.pool.acquire().await?;
            ScopeOperator::new(&mut connection)
                .get_or_create(kind, date)
                .await
        })
    }

    /// Returns the Part-of-Day scope for `date` + `part`, creating it (and its Day, Week,
    /// Month, Season parents) if absent. The scope inherits its Day's containment ids.
    pub async fn get_or_create_part(
        &self,
        date: NaiveDate,
        part: PartOfDay,
    ) -> Result<Scope, ScopeError> {
        let mut connection = self.pool.acquire().await?;
        ScopeOperator::new(&mut connection)
            .get_or_create_part(date, part)
            .await
    }

    /// Returns the Exact scope for the half-open `[start, end)` datetime window, creating it
    /// if absent. Exact scopes lie outside the canonical hierarchy and carry no containment ids.
    pub async fn get_or_create_exact(
        &self,
        start: NaiveDateTime,
        end: NaiveDateTime,
    ) -> Result<Scope, ScopeError> {
        let mut connection = self.pool.acquire().await?;
        ScopeOperator::new(&mut connection)
            .get_or_create_exact(start, end)
            .await
    }
}

/// Computes the inclusive [start, end] date range for a canonical scope.
fn scope_bounds(kind: CanonicalKind, date: NaiveDate) -> (NaiveDate, NaiveDate) {
    match kind {
        CanonicalKind::Day => (date, date),
        CanonicalKind::Week => {
            let days_since_sunday = date.weekday().num_days_from_sunday();
            let sunday = date - Duration::days(days_since_sunday as i64);
            let saturday = sunday + Duration::days(6);
            (sunday, saturday)
        }
        CanonicalKind::Month => {
            let start = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap();
            let next_month = if date.month() == 12 {
                NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).unwrap()
            } else {
                NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1).unwrap()
            };
            let end = next_month - Duration::days(1);
            (start, end)
        }
        CanonicalKind::Season => {
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

/// Returns the human-readable label for a canonical scope.
fn scope_label(kind: CanonicalKind, date: NaiveDate) -> String {
    match kind {
        CanonicalKind::Day => date.format("%Y-%m-%d").to_string(),
        CanonicalKind::Week => {
            let week_num = week_number(date);
            format!("Week {} {}", week_num, date.year())
        }
        CanonicalKind::Month => date.format("%B %Y").to_string(),
        CanonicalKind::Season => {
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
        assert_eq!(scope_bounds(CanonicalKind::Day, date), (date, date));
    }

    // --- scope_bounds: Week ---

    #[test]
    fn bounds_week_saturday_starts_on_sunday() {
        // 2026-06-20 is Saturday
        let (start, end) = scope_bounds(CanonicalKind::Week, d(2026, 6, 20));
        assert_eq!(start, d(2026, 6, 14));
        assert_eq!(end, d(2026, 6, 20));
    }

    #[test]
    fn bounds_week_wednesday_same_sunday_anchor() {
        // 2026-06-17 is Wednesday → same week as the Saturday above
        let (start, end) = scope_bounds(CanonicalKind::Week, d(2026, 6, 17));
        assert_eq!(start, d(2026, 6, 14));
        assert_eq!(end, d(2026, 6, 20));
    }

    #[test]
    fn bounds_week_sunday_is_its_own_start() {
        let (start, _end) = scope_bounds(CanonicalKind::Week, d(2026, 6, 14));
        assert_eq!(start, d(2026, 6, 14));
    }

    // --- scope_bounds: Month ---

    #[test]
    fn bounds_month_june_ends_on_30() {
        let (start, end) = scope_bounds(CanonicalKind::Month, d(2026, 6, 15));
        assert_eq!(start, d(2026, 6, 1));
        assert_eq!(end, d(2026, 6, 30));
    }

    #[test]
    fn bounds_month_december_stays_within_year() {
        let (start, end) = scope_bounds(CanonicalKind::Month, d(2026, 12, 15));
        assert_eq!(start, d(2026, 12, 1));
        assert_eq!(end, d(2026, 12, 31));
    }

    #[test]
    fn bounds_month_february_non_leap_ends_on_28() {
        let (start, end) = scope_bounds(CanonicalKind::Month, d(2026, 2, 10));
        assert_eq!(start, d(2026, 2, 1));
        assert_eq!(end, d(2026, 2, 28));
    }

    #[test]
    fn bounds_month_february_leap_ends_on_29() {
        let (start, end) = scope_bounds(CanonicalKind::Month, d(2024, 2, 15));
        assert_eq!(start, d(2024, 2, 1));
        assert_eq!(end, d(2024, 2, 29));
    }

    // --- scope_bounds: Season ---

    #[test]
    fn bounds_season_summer_june_to_august() {
        let (start, end) = scope_bounds(CanonicalKind::Season, d(2026, 6, 20));
        assert_eq!(start, d(2026, 6, 1));
        assert_eq!(end, d(2026, 8, 31));
    }

    #[test]
    fn bounds_season_autumn_september_to_november() {
        let (start, end) = scope_bounds(CanonicalKind::Season, d(2026, 10, 1));
        assert_eq!(start, d(2026, 9, 1));
        assert_eq!(end, d(2026, 11, 30));
    }

    #[test]
    fn bounds_season_spring_march_to_may() {
        let (start, end) = scope_bounds(CanonicalKind::Season, d(2026, 4, 15));
        assert_eq!(start, d(2026, 3, 1));
        assert_eq!(end, d(2026, 5, 31));
    }

    #[test]
    fn bounds_season_winter_december_crosses_year() {
        let (start, end) = scope_bounds(CanonicalKind::Season, d(2026, 12, 1));
        assert_eq!(start, d(2026, 12, 1));
        assert_eq!(end, d(2027, 2, 28));
    }

    #[test]
    fn bounds_season_winter_january_traces_to_december() {
        let (start, end) = scope_bounds(CanonicalKind::Season, d(2027, 1, 15));
        assert_eq!(start, d(2026, 12, 1));
        assert_eq!(end, d(2027, 2, 28));
    }

    // --- scope_label ---

    #[test]
    fn label_day_formats_as_iso() {
        assert_eq!(scope_label(CanonicalKind::Day, d(2026, 6, 20)), "2026-06-20");
    }

    #[test]
    fn label_month_is_full_name_and_year() {
        assert_eq!(scope_label(CanonicalKind::Month, d(2026, 6, 15)), "June 2026");
    }

    #[test]
    fn label_season_summer() {
        assert_eq!(scope_label(CanonicalKind::Season, d(2026, 7, 1)), "Summer 2026");
    }

    #[test]
    fn label_season_winter_december_uses_start_year() {
        assert_eq!(scope_label(CanonicalKind::Season, d(2026, 12, 1)), "Winter 2026");
    }

    #[test]
    fn label_season_winter_january_uses_previous_year() {
        assert_eq!(scope_label(CanonicalKind::Season, d(2027, 1, 15)), "Winter 2026");
    }

    #[test]
    fn label_week_contains_number_and_year() {
        let label = scope_label(CanonicalKind::Week, d(2026, 6, 20));
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
        assert!((24..=26).contains(&w), "week {w} out of expected range 24–26");
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
