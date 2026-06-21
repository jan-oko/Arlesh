//! Scope resource models.

use serde::{Deserialize, Serialize};

/// Identifies a scope row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeId(pub i64);

impl From<i64> for ScopeId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<ScopeId> for i64 {
    fn from(id: ScopeId) -> Self {
        id.0
    }
}

/// The granularity of a time scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScopeKind {
    /// Three-month season (Autumn/Winter/Spring/Summer).
    Season,
    /// Calendar month.
    Month,
    /// Sunday–Saturday week with custom 1-52 numbering.
    Week,
    /// Single calendar day.
    Day,
}

impl ScopeKind {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Season => "season",
            Self::Month => "month",
            Self::Week => "week",
            Self::Day => "day",
        }
    }
}

/// A scope row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Scope {
    /// Primary key.
    pub id: i64,
    /// Granularity.
    pub kind: String,
    /// Human-readable label (e.g. "June 2026", "Week 25 2026").
    pub label: String,
    /// ISO 8601 start date (inclusive).
    pub start_date: String,
    /// ISO 8601 end date (inclusive).
    pub end_date: String,
    /// Id of the containing Week scope (Day scopes only).
    pub week_id: Option<i64>,
    /// Id of the containing Month scope (Day scopes only).
    pub month_id: Option<i64>,
    /// Id of the containing Season scope (Day and Month scopes).
    pub season_id: Option<i64>,
}
