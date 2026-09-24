//! A scope's value key: the scope's identity, and everything needed to derive it.
//!
//! A key is a discriminated union tagged by `kind` that names the scope's own start. It is what
//! every column referencing a scope holds and what every wire field carries (ADR 0009):
//!
//! | Kind        | Key                                                                         |
//! |-------------|-----------------------------------------------------------------------------|
//! | Season      | `{"kind":"season","date":"2026-09-01"}`                                     |
//! | Month       | `{"kind":"month","date":"2026-09-01"}`                                      |
//! | Week        | `{"kind":"week","date":"2026-09-20"}`                                       |
//! | Day         | `{"kind":"day","date":"2026-09-23"}`                                        |
//! | Part of Day | `{"kind":"part_of_day","date":"2026-09-23","part":"morning"}`               |
//! | Exact       | `{"kind":"exact","start":"2026-09-23T14:00:00","end":"2026-09-23T15:30:00"}` |
//!
//! On the wire a key is that JSON object. In a column it is the object's **canonical text** — the
//! spelling above exactly: `kind` first, the fields in that order, no whitespace, `YYYY-MM-DD` dates
//! and `YYYY-MM-DDTHH:MM:SS` datetimes. [`ScopeKey::canonical`] is the one place that text is
//! produced, and every key is re-serialised from its parsed value before it is stored, so comparing
//! the stored text compares scopes.
//!
//! A key that does not name its own start — a week keyed by a Wednesday — is refused on the way in
//! and on the way to the database, never snapped. Finding the scope that *contains* a date is
//! [`ScopeKey::containing`].

use std::fmt;
use std::str::FromStr;

use chrono::{NaiveDate, NaiveDateTime, Timelike};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::sqlite::{Sqlite, SqliteArgumentValue, SqliteTypeInfo, SqliteValueRef};
use sqlx::{Decode, Encode, Type};

use super::derive::{scope_dates, scope_label, CanonicalKind};
use super::error::ScopeError;
use super::model::{PartOfDay, Scope, ScopeKind};
use super::resolve::{canonical_bounds, part_of_day_bounds, Bounds, EXACT_DATETIME_FORMAT};

/// The format of every date in a key.
const DATE_FORMAT: &str = "%Y-%m-%d";

/// The value key of one scope. Cheap to copy, hashable, and a pure function of the scope.
///
/// Build one with [`ScopeKey::containing`], [`ScopeKey::day`], [`ScopeKey::part`] or
/// [`ScopeKey::exact`], or by deserialising it; all of them guarantee the key names its own start.
/// The variants are public so that a key can be matched on, and a key built from them by hand is
/// checked when it is written to the database.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScopeKey {
    /// A Season, by its first day (the 1st of December, March, June or September).
    Season {
        /// The season's first day.
        date: NaiveDate,
    },
    /// A calendar Month, by its first day.
    Month {
        /// The month's first day.
        date: NaiveDate,
    },
    /// A Sunday-to-Saturday Week, by its Sunday.
    Week {
        /// The week's Sunday.
        date: NaiveDate,
    },
    /// A Day.
    Day {
        /// The day.
        date: NaiveDate,
    },
    /// A Part of Day: a band on the day it starts on (Night belongs to the day it starts on).
    PartOfDay {
        /// The day the band starts on.
        date: NaiveDate,
        /// The band.
        part: PartOfDay,
    },
    /// A half-open `[start, end)` window, in whole seconds.
    Exact {
        /// Inclusive start.
        start: NaiveDateTime,
        /// Exclusive end.
        end: NaiveDateTime,
    },
}

/// The wire and storage shape of a key: every date as its canonical text. Serialising this is the
/// canonical form, because serde writes the tag first and the fields in declaration order.
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Wire {
    Season { date: String },
    Month { date: String },
    Week { date: String },
    Day { date: String },
    PartOfDay { date: String, part: PartOfDay },
    Exact { start: String, end: String },
}

impl ScopeKey {
    /// The Season, Month, Week or Day of `kind` that holds `date`.
    ///
    /// Part-of-Day and Exact carry more than a date; they have [`Self::part`] and [`Self::exact`].
    pub fn containing(kind: ScopeKind, date: NaiveDate) -> Result<Self, ScopeError> {
        let canonical = CanonicalKind::from_scope_kind(kind)
            .ok_or(ScopeError::UnsupportedKind(kind.as_str()))?;
        Ok(Self::canonical_key(
            canonical,
            scope_dates(canonical, date).0,
        ))
    }

    /// The Day scope of `date`.
    pub fn day(date: NaiveDate) -> Self {
        Self::Day { date }
    }

    /// The Part-of-Day scope for `part` on the day `date`. Night belongs to the day it starts on.
    pub fn part(date: NaiveDate, part: PartOfDay) -> Self {
        Self::PartOfDay { date, part }
    }

    /// The Exact scope for the half-open `[start, end)` window. Refuses an empty or inverted one,
    /// and one that is not in whole seconds.
    pub fn exact(start: NaiveDateTime, end: NaiveDateTime) -> Result<Self, ScopeError> {
        Self::Exact { start, end }.validated()
    }

    /// The key of the canonical scope of `kind` starting on `start`, unchecked.
    fn canonical_key(kind: CanonicalKind, start: NaiveDate) -> Self {
        match kind {
            CanonicalKind::Season => Self::Season { date: start },
            CanonicalKind::Month => Self::Month { date: start },
            CanonicalKind::Week => Self::Week { date: start },
            CanonicalKind::Day => Self::Day { date: start },
        }
    }

    /// The canonical kind and date of a Season, Month, Week or Day; `None` for the other two.
    fn as_canonical(&self) -> Option<(CanonicalKind, NaiveDate)> {
        match *self {
            Self::Season { date } => Some((CanonicalKind::Season, date)),
            Self::Month { date } => Some((CanonicalKind::Month, date)),
            Self::Week { date } => Some((CanonicalKind::Week, date)),
            Self::Day { date } => Some((CanonicalKind::Day, date)),
            Self::PartOfDay { .. } | Self::Exact { .. } => None,
        }
    }

    /// This key, if it names its own scope's start (and an Exact window is non-empty and in whole
    /// seconds); the reason it does not otherwise.
    pub fn validated(self) -> Result<Self, ScopeError> {
        if let Some((kind, date)) = self.as_canonical() {
            if scope_dates(kind, date).0 != date {
                return Err(ScopeError::MalformedKey(
                    self.canonical(),
                    "the date is not the start of its scope".to_string(),
                ));
            }
        }
        if let Self::Exact { start, end } = self {
            let format = |at: NaiveDateTime| at.format(EXACT_DATETIME_FORMAT).to_string();
            if start >= end {
                return Err(ScopeError::EmptyExact(format(start), format(end)));
            }
            if start.nanosecond() != 0 || end.nanosecond() != 0 {
                return Err(ScopeError::MalformedKey(
                    self.canonical(),
                    "an exact window is in whole seconds".to_string(),
                ));
            }
        }
        Ok(self)
    }

    /// The key's canonical text: what a column holds, and the one spelling of this scope.
    pub fn canonical(&self) -> String {
        // A struct of strings and a unit-variant enum cannot fail to serialise.
        serde_json::to_string(&self.wire()).unwrap_or_default()
    }

    /// The key as its wire shape, every date formatted canonically.
    fn wire(&self) -> Wire {
        let day = |date: NaiveDate| date.format(DATE_FORMAT).to_string();
        let at = |instant: NaiveDateTime| instant.format(EXACT_DATETIME_FORMAT).to_string();
        match *self {
            Self::Season { date } => Wire::Season { date: day(date) },
            Self::Month { date } => Wire::Month { date: day(date) },
            Self::Week { date } => Wire::Week { date: day(date) },
            Self::Day { date } => Wire::Day { date: day(date) },
            Self::PartOfDay { date, part } => Wire::PartOfDay {
                date: day(date),
                part,
            },
            Self::Exact { start, end } => Wire::Exact {
                start: at(start),
                end: at(end),
            },
        }
    }

    /// The scope's granularity.
    pub fn kind(&self) -> ScopeKind {
        match self {
            Self::Season { .. } => ScopeKind::Season,
            Self::Month { .. } => ScopeKind::Month,
            Self::Week { .. } => ScopeKind::Week,
            Self::Day { .. } => ScopeKind::Day,
            Self::PartOfDay { .. } => ScopeKind::PartOfDay,
            Self::Exact { .. } => ScopeKind::Exact,
        }
    }

    /// The scope's first day: a canonical scope's start, a part's day, an exact window's start date.
    pub fn start_date(&self) -> NaiveDate {
        match *self {
            Self::Season { date }
            | Self::Month { date }
            | Self::Week { date }
            | Self::Day { date }
            | Self::PartOfDay { date, .. } => date,
            Self::Exact { start, .. } => start.date(),
        }
    }

    /// The scope's last day, inclusive. A Night ends on the day after it starts; an exact window on
    /// its end's date.
    pub fn end_date(&self) -> NaiveDate {
        match (self.as_canonical(), *self) {
            (Some((kind, date)), _) => scope_dates(kind, date).1,
            (None, Self::Exact { end, .. }) => end.date(),
            (None, _) => self.bounds().1.date(),
        }
    }

    /// The band of a Part-of-Day scope.
    pub fn part_of_day(&self) -> Option<PartOfDay> {
        match *self {
            Self::PartOfDay { part, .. } => Some(part),
            _ => None,
        }
    }

    /// The scope's half-open `[start, end)` datetime window. A canonical scope runs 02:00 → 02:00
    /// (see [`super::resolve::DAY_BOUNDARY_HOUR`]).
    pub fn bounds(&self) -> Bounds {
        match (self.as_canonical(), *self) {
            (Some((kind, date)), _) => {
                let (first, last) = scope_dates(kind, date);
                canonical_bounds(first, last)
            }
            (None, Self::PartOfDay { date, part }) => part_of_day_bounds(date, part),
            (None, Self::Exact { start, end }) => (start, end),
            // Unreachable: every canonical variant answers `as_canonical`.
            (None, _) => canonical_bounds(self.start_date(), self.start_date()),
        }
    }

    /// The human-readable label: `2026-09-23`, `Week 38 2026`, `September 2026`, `Autumn 2026`,
    /// `2026-09-23 morning`, or an exact window's two datetimes.
    pub fn label(&self) -> String {
        match (self.as_canonical(), *self) {
            (Some((kind, date)), _) => scope_label(kind, date),
            (None, Self::PartOfDay { date, part }) => {
                format!(
                    "{} {}",
                    scope_label(CanonicalKind::Day, date),
                    part.as_str()
                )
            }
            (None, Self::Exact { start, end }) => format!(
                "{} – {}",
                start.format(EXACT_DATETIME_FORMAT),
                end.format(EXACT_DATETIME_FORMAT)
            ),
            (None, _) => String::new(),
        }
    }

    /// The scope this key names, with every derived field filled in.
    pub fn scope(&self) -> Scope {
        let exact = |at: NaiveDateTime| at.format(EXACT_DATETIME_FORMAT).to_string();
        let (start_datetime, end_datetime) = match *self {
            Self::Exact { start, end } => (Some(exact(start)), Some(exact(end))),
            _ => (None, None),
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

impl TryFrom<Wire> for ScopeKey {
    type Error = ScopeError;

    fn try_from(wire: Wire) -> Result<Self, Self::Error> {
        // Strict: a date is accepted only in its canonical spelling, so what parses is what the
        // key would itself write.
        let date = |raw: String| {
            NaiveDate::parse_from_str(&raw, DATE_FORMAT)
                .ok()
                .filter(|parsed| parsed.format(DATE_FORMAT).to_string() == raw)
                .ok_or_else(|| ScopeError::MalformedKey(raw.clone(), "bad date".to_string()))
        };
        let at = |raw: String| {
            NaiveDateTime::parse_from_str(&raw, EXACT_DATETIME_FORMAT)
                .ok()
                .filter(|parsed| parsed.format(EXACT_DATETIME_FORMAT).to_string() == raw)
                .ok_or_else(|| ScopeError::MalformedKey(raw.clone(), "bad datetime".to_string()))
        };
        let key = match wire {
            Wire::Season { date: raw } => Self::Season { date: date(raw)? },
            Wire::Month { date: raw } => Self::Month { date: date(raw)? },
            Wire::Week { date: raw } => Self::Week { date: date(raw)? },
            Wire::Day { date: raw } => Self::Day { date: date(raw)? },
            Wire::PartOfDay { date: raw, part } => Self::PartOfDay {
                date: date(raw)?,
                part,
            },
            Wire::Exact { start, end } => Self::Exact {
                start: at(start)?,
                end: at(end)?,
            },
        };
        key.validated()
    }
}

/// The canonical text, so a key reads in a log or a message exactly as it is stored.
impl fmt::Display for ScopeKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.canonical())
    }
}

/// Parses a key from JSON text — any spelling of it; [`ScopeKey::canonical`] gives the one spelling.
impl FromStr for ScopeKey {
    type Err = ScopeError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        let wire: Wire = serde_json::from_str(raw)
            .map_err(|error| ScopeError::MalformedKey(raw.to_string(), error.to_string()))?;
        Self::try_from(wire)
    }
}

impl Serialize for ScopeKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.wire().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ScopeKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = Wire::deserialize(deserializer)?;
        Self::try_from(wire).map_err(serde::de::Error::custom)
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

/// Writes the canonical text — after checking the key names its own start, since a variant built
/// by hand has not been checked yet.
impl<'q> Encode<'q, Sqlite> for ScopeKey {
    fn encode_by_ref(&self, buf: &mut Vec<SqliteArgumentValue<'q>>) -> Result<IsNull, BoxDynError> {
        let key = self.validated()?;
        <String as Encode<'q, Sqlite>>::encode(key.canonical(), buf)
    }
}

impl<'r> Decode<'r, Sqlite> for ScopeKey {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        let raw = <&str as Decode<'r, Sqlite>>::decode(value)?;
        Ok(raw.parse::<ScopeKey>()?)
    }
}

/// A distinct Day key per integer, for unit tests that only need scope ids as opaque tokens —
/// what an integer scope id used to be.
#[cfg(test)]
pub(crate) fn test_key(n: i64) -> ScopeKey {
    let epoch = NaiveDate::from_ymd_opt(2000, 1, 1).unwrap_or_default();
    ScopeKey::day(epoch + chrono::Duration::days(n.rem_euclid(100_000)))
}

#[cfg(test)]
mod tests;
