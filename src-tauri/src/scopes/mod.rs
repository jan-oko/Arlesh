//! Time scopes: Seasons, Months, Weeks, Days.

pub mod error;
pub mod model;
pub mod resolve;

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};

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
    /// A check-then-write that nonetheless stays an **operator method**, which the rule allows
    /// only when a schema constraint independently enforces the checked invariant. Here it does:
    /// `scopes_canonical_uniq` (`migrations/0005_part_of_day_and_exact_scopes.sql`) is unique on
    /// `(kind, start_date)` for the four canonical kinds, so a lost race between the probe and the
    /// insert raises a constraint error rather than producing a duplicate scope. Contrast
    /// [`crate::tasks::add_task_dependency`], whose acyclicity check has no such backstop and is
    /// therefore a free function over a transactional session. Staying a method is also what lets
    /// the five window helpers in `flows` hold only a `&mut ScopeOperator`, as ADR-0004 requires.
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

            if let Some(scope) =
                sqlx::query_as::<_, Scope>("SELECT * FROM scopes WHERE kind = ? AND start_date = ?")
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
    /// An operator method for the same reason as [`Self::get_or_create`]: `scopes_part_uniq` is
    /// unique on `(start_date, part)` for `part_of_day` rows, so a lost race between the probe and
    /// the insert is a constraint error, not a duplicate.
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
    ///
    /// An operator method for the same reason as [`Self::get_or_create`]: `scopes_exact_uniq` is
    /// unique on `(start_datetime, end_datetime)` for `exact` rows, so a lost race between the
    /// probe and the insert is a constraint error, not a duplicate.
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
            let end_year = if season_month + 2 > 12 {
                year + 1
            } else {
                year
            };
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
mod tests;
