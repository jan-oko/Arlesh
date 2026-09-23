//! A scope's value key: the scope's identity, and everything needed to derive it.
//!
//! A key is a canonical string that names the scope's own start — `week:2026-09-20` is the week
//! whose Sunday is the 20th. It is what every column referencing a scope holds and what every wire
//! field carries (ADR 0009):
//!
//! | Kind        | Key                                             |
//! |-------------|-------------------------------------------------|
//! | Season      | `season:2026-09-01`                             |
//! | Month       | `month:2026-09-01`                              |
//! | Week        | `week:2026-09-20`                               |
//! | Day         | `day:2026-09-23`                                |
//! | Part of Day | `part_of_day:2026-09-23:morning`                |
//! | Exact       | `exact:2026-09-23T14:00:00/2026-09-23T15:30:00` |
//!
//! Parsing refuses a key that is not in this exact spelling — including a canonical key naming a
//! date that is not its scope's start — so one scope has one key and comparing keys compares
//! scopes. Finding the scope that *contains* a date is [`ScopeKey::containing`].

use std::fmt;
use std::str::FromStr;

use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::sqlite::{Sqlite, SqliteArgumentValue, SqliteTypeInfo, SqliteValueRef};
use sqlx::{Decode, Encode, Type};

use super::derive::{scope_dates, scope_label, CanonicalKind};
use super::error::ScopeError;
use super::model::{PartOfDay, Scope, ScopeKind};
use super::resolve::{canonical_bounds, part_of_day_bounds, Bounds, EXACT_DATETIME_FORMAT};

/// The value key of one scope. Cheap to copy, hashable, and a pure function of the scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ScopeKey(Cell);

/// What a key names. Private so that every key is built through a constructor that guarantees it
/// is canonical.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Cell {
    /// A Season, Month, Week or Day, by its first day.
    Canonical(CanonicalKind, NaiveDate),
    /// A band on the day it starts on.
    PartOfDay(NaiveDate, PartOfDay),
    /// A half-open `[start, end)` datetime window.
    Exact(NaiveDateTime, NaiveDateTime),
}

impl ScopeKey {
    /// The Season, Month, Week or Day of `kind` that holds `date`.
    ///
    /// Part-of-Day and Exact carry more than a date; they have [`Self::part`] and [`Self::exact`].
    pub fn containing(kind: ScopeKind, date: NaiveDate) -> Result<Self, ScopeError> {
        let canonical = CanonicalKind::from_scope_kind(kind)
            .ok_or(ScopeError::UnsupportedKind(kind.as_str()))?;
        let (start, _) = scope_dates(canonical, date);
        Ok(Self(Cell::Canonical(canonical, start)))
    }

    /// The Day scope of `date`.
    pub fn day(date: NaiveDate) -> Self {
        Self(Cell::Canonical(CanonicalKind::Day, date))
    }

    /// The Part-of-Day scope for `part` on the day `date`. Night belongs to the day it starts on.
    pub fn part(date: NaiveDate, part: PartOfDay) -> Self {
        Self(Cell::PartOfDay(date, part))
    }

    /// The Exact scope for the half-open `[start, end)` window. Refuses an empty or inverted one.
    pub fn exact(start: NaiveDateTime, end: NaiveDateTime) -> Result<Self, ScopeError> {
        if start >= end {
            return Err(ScopeError::EmptyExact(
                start.format(EXACT_DATETIME_FORMAT).to_string(),
                end.format(EXACT_DATETIME_FORMAT).to_string(),
            ));
        }
        Ok(Self(Cell::Exact(start, end)))
    }

    /// The scope's granularity.
    pub fn kind(&self) -> ScopeKind {
        match self.0 {
            Cell::Canonical(kind, _) => kind.as_scope_kind(),
            Cell::PartOfDay(..) => ScopeKind::PartOfDay,
            Cell::Exact(..) => ScopeKind::Exact,
        }
    }

    /// Whether this is an Exact scope — the one kind kept as a row, in `exact_scopes`.
    pub fn is_exact(&self) -> bool {
        matches!(self.0, Cell::Exact(..))
    }

    /// The scope's first day: a canonical scope's start, a part's day, an exact window's start date.
    pub fn start_date(&self) -> NaiveDate {
        match self.0 {
            Cell::Canonical(_, start) => start,
            Cell::PartOfDay(date, _) => date,
            Cell::Exact(start, _) => start.date(),
        }
    }

    /// The scope's last day, inclusive. A Night ends on the day after it starts; an exact window on
    /// its end's date.
    pub fn end_date(&self) -> NaiveDate {
        match self.0 {
            Cell::Canonical(kind, start) => scope_dates(kind, start).1,
            Cell::PartOfDay(..) => self.bounds().1.date(),
            Cell::Exact(_, end) => end.date(),
        }
    }

    /// The band of a Part-of-Day scope.
    pub fn part_of_day(&self) -> Option<PartOfDay> {
        match self.0 {
            Cell::PartOfDay(_, part) => Some(part),
            Cell::Canonical(..) | Cell::Exact(..) => None,
        }
    }

    /// The scope's half-open `[start, end)` datetime window. A canonical scope runs 02:00 → 02:00
    /// (see [`super::resolve::DAY_BOUNDARY_HOUR`]).
    pub fn bounds(&self) -> Bounds {
        match self.0 {
            Cell::Canonical(kind, start) => {
                let (first, last) = scope_dates(kind, start);
                canonical_bounds(first, last)
            }
            Cell::PartOfDay(date, part) => part_of_day_bounds(date, part),
            Cell::Exact(start, end) => (start, end),
        }
    }

    /// The human-readable label: `2026-09-23`, `Week 38 2026`, `September 2026`, `Autumn 2026`,
    /// `2026-09-23 morning`, or an exact window's two datetimes.
    pub fn label(&self) -> String {
        match self.0 {
            Cell::Canonical(kind, start) => scope_label(kind, start),
            Cell::PartOfDay(date, part) => {
                format!(
                    "{} {}",
                    scope_label(CanonicalKind::Day, date),
                    part.as_str()
                )
            }
            Cell::Exact(start, end) => format!(
                "{} – {}",
                start.format(EXACT_DATETIME_FORMAT),
                end.format(EXACT_DATETIME_FORMAT)
            ),
        }
    }

    /// The scope this key names, with every derived field filled in.
    pub fn scope(&self) -> Scope {
        let exact = |at: NaiveDateTime| at.format(EXACT_DATETIME_FORMAT).to_string();
        let (start_datetime, end_datetime) = match self.0 {
            Cell::Exact(start, end) => (Some(exact(start)), Some(exact(end))),
            Cell::Canonical(..) | Cell::PartOfDay(..) => (None, None),
        };
        Scope {
            id: *self,
            kind: self.kind().as_str().to_string(),
            label: self.label(),
            start_date: self.start_date().to_string(),
            end_date: self.end_date().to_string(),
            part: self.part_of_day().map(|part| part.as_str().to_string()),
            start_datetime,
            end_datetime,
        }
    }
}

impl Scope {
    /// The Season, Month, Week or Day of `kind` that holds `date`; see [`ScopeKey::containing`].
    pub fn containing(kind: ScopeKind, date: NaiveDate) -> Result<Self, ScopeError> {
        Ok(ScopeKey::containing(kind, date)?.scope())
    }

    /// The Part-of-Day scope for `part` on `date`; see [`ScopeKey::part`].
    pub fn part(date: NaiveDate, part: PartOfDay) -> Self {
        ScopeKey::part(date, part).scope()
    }

    /// The Exact scope for `[start, end)`; see [`ScopeKey::exact`].
    pub fn exact(start: NaiveDateTime, end: NaiveDateTime) -> Result<Self, ScopeError> {
        Ok(ScopeKey::exact(start, end)?.scope())
    }
}

impl fmt::Display for ScopeKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Cell::Canonical(kind, start) => write!(f, "{}:{start}", kind.as_scope_kind().as_str()),
            Cell::PartOfDay(date, part) => write!(f, "part_of_day:{date}:{}", part.as_str()),
            Cell::Exact(start, end) => write!(
                f,
                "exact:{}/{}",
                start.format(EXACT_DATETIME_FORMAT),
                end.format(EXACT_DATETIME_FORMAT)
            ),
        }
    }
}

impl FromStr for ScopeKey {
    type Err = ScopeError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        let malformed =
            |reason: &str| ScopeError::MalformedKey(raw.to_string(), reason.to_string());
        let (kind, rest) = raw.split_once(':').ok_or_else(|| malformed("no kind"))?;
        let date = |value: &str| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| malformed("bad date"))
        };
        let datetime = |value: &str| {
            NaiveDateTime::parse_from_str(value, EXACT_DATETIME_FORMAT)
                .map_err(|_| malformed("bad datetime"))
        };
        let key = match ScopeKind::parse_db(kind).ok_or_else(|| malformed("unknown kind"))? {
            ScopeKind::PartOfDay => {
                let (day, band) = rest.split_once(':').ok_or_else(|| malformed("no band"))?;
                let part = PartOfDay::parse_db(band).ok_or_else(|| malformed("unknown band"))?;
                Self::part(date(day)?, part)
            }
            ScopeKind::Exact => {
                let (start, end) = rest.split_once('/').ok_or_else(|| malformed("no end"))?;
                Self::exact(datetime(start)?, datetime(end)?)?
            }
            canonical => Self::containing(canonical, date(rest)?)?,
        };
        // One scope, one spelling: a date that is not its scope's start, or any other spelling
        // chrono is lenient about, does not round-trip and is refused.
        if key.to_string() != raw {
            return Err(malformed("not the canonical spelling of its scope"));
        }
        Ok(key)
    }
}

impl Serialize for ScopeKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for ScopeKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        raw.parse().map_err(serde::de::Error::custom)
    }
}

impl Type<Sqlite> for ScopeKey {
    fn type_info() -> SqliteTypeInfo {
        <String as Type<Sqlite>>::type_info()
    }

    fn compatible(ty: &SqliteTypeInfo) -> bool {
        <String as Type<Sqlite>>::compatible(ty)
    }
}

impl<'q> Encode<'q, Sqlite> for ScopeKey {
    fn encode_by_ref(&self, buf: &mut Vec<SqliteArgumentValue<'q>>) -> Result<IsNull, BoxDynError> {
        <String as Encode<'q, Sqlite>>::encode(self.to_string(), buf)
    }
}

impl<'r> Decode<'r, Sqlite> for ScopeKey {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        let raw = <&str as Decode<'r, Sqlite>>::decode(value)?;
        Ok(raw.parse::<ScopeKey>()?)
    }
}

#[cfg(test)]
mod tests;

/// A distinct Day key per integer, for unit tests that only need scope ids as opaque tokens —
/// what an integer scope id used to be.
#[cfg(test)]
pub(crate) fn test_key(n: i64) -> ScopeKey {
    let epoch = NaiveDate::from_ymd_opt(2000, 1, 1).unwrap_or_default();
    ScopeKey::day(epoch + chrono::Duration::days(n.rem_euclid(100_000)))
}
