//! Scope resource models.

use serde::{Deserialize, Serialize};

use super::key::ScopeKey;

/// The granularity of a time scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeKind {
    /// Three-month season (Autumn/Winter/Spring/Summer).
    Season,
    /// Calendar month.
    Month,
    /// Sunday–Saturday week with custom 1-52 numbering.
    Week,
    /// Single calendar day.
    Day,
    /// Sub-day band (Morning, Noon, Afternoon, Evening, Night, Premorning).
    PartOfDay,
    /// Arbitrary minute-precision datetime range, outside the canonical hierarchy.
    Exact,
}

impl ScopeKind {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Season => "season",
            Self::Month => "month",
            Self::Week => "week",
            Self::Day => "day",
            Self::PartOfDay => "part_of_day",
            Self::Exact => "exact",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn parse_db(value: &str) -> Option<Self> {
        match value {
            "season" => Some(Self::Season),
            "month" => Some(Self::Month),
            "week" => Some(Self::Week),
            "day" => Some(Self::Day),
            "part_of_day" => Some(Self::PartOfDay),
            "exact" => Some(Self::Exact),
            _ => None,
        }
    }
}

/// One of the six sub-day bands. Hours are local wall-clock, start inclusive / end exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PartOfDay {
    /// 06:00–12:00.
    Morning,
    /// 12:00–15:00.
    Noon,
    /// 15:00–18:00.
    Afternoon,
    /// 18:00–22:00.
    Evening,
    /// 22:00–02:00 (crosses midnight; belongs to the day it starts on).
    Night,
    /// 02:00–06:00.
    Premorning,
}

impl PartOfDay {
    /// The six parts in their daily cycle order, beginning with Morning.
    pub const CYCLE: [PartOfDay; 6] = [
        Self::Morning,
        Self::Noon,
        Self::Afternoon,
        Self::Evening,
        Self::Night,
        Self::Premorning,
    ];

    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Morning => "morning",
            Self::Noon => "noon",
            Self::Afternoon => "afternoon",
            Self::Evening => "evening",
            Self::Night => "night",
            Self::Premorning => "premorning",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn parse_db(value: &str) -> Option<Self> {
        match value {
            "morning" => Some(Self::Morning),
            "noon" => Some(Self::Noon),
            "afternoon" => Some(Self::Afternoon),
            "evening" => Some(Self::Evening),
            "night" => Some(Self::Night),
            "premorning" => Some(Self::Premorning),
            _ => None,
        }
    }

    /// The `[start_hour, end_hour)` band. Night returns `(22, 2)`, denoting a wrap past midnight.
    pub fn band(&self) -> (u32, u32) {
        match self {
            Self::Morning => (6, 12),
            Self::Noon => (12, 15),
            Self::Afternoon => (15, 18),
            Self::Evening => (18, 22),
            Self::Night => (22, 2),
            Self::Premorning => (2, 6),
        }
    }

    /// Returns the part containing the given wall-clock `hour` (0–23). Hours 00:00–01:59
    /// fall in Night (owned by the previous day's Night band).
    pub fn containing(hour: u32) -> PartOfDay {
        match hour % 24 {
            0..=1 => Self::Night,
            2..=5 => Self::Premorning,
            6..=11 => Self::Morning,
            12..=14 => Self::Noon,
            15..=17 => Self::Afternoon,
            18..=21 => Self::Evening,
            _ => Self::Night,
        }
    }
}

#[cfg(test)]
mod tests;

/// A scope as it travels on the wire: its key plus everything derived from it.
///
/// Nothing here is stored. A canonical scope is computed from its [`ScopeKey`] on every read, and
/// an Exact scope's fields are its key's two datetimes (ADR 0009).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scope {
    /// The scope's identity: its canonical value key, e.g. `week:2026-09-20`.
    pub id: ScopeKey,
    /// Granularity, as [`ScopeKind::as_str`] spells it.
    pub kind: String,
    /// Human-readable label (e.g. "June 2026", "Week 25 2026").
    pub label: String,
    /// ISO 8601 start date (inclusive).
    pub start_date: String,
    /// ISO 8601 end date (inclusive).
    pub end_date: String,
    /// Which sub-day band (Part-of-Day scopes only).
    pub part: Option<String>,
    /// Explicit start datetime, ISO 8601 minute precision (Exact scopes only).
    pub start_datetime: Option<String>,
    /// Explicit end datetime, ISO 8601 minute precision (Exact scopes only).
    pub end_datetime: Option<String>,
}
