//! The pure items of a wait: which kind it is, how a check names it, and the instant spelling the
//! `wait_checks` columns store.

use chrono::NaiveDateTime;
use serde::Serialize;

/// The spelling of an instant in a TEXT column.
pub const INSTANT_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";

/// Spells an instant the way the `wait_checks` columns store it.
pub fn instant_column(at: NaiveDateTime) -> String {
    at.format(INSTANT_FORMAT).to_string()
}

/// Which kind of wait a check belongs to.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, serde::Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum WaitKind {
    /// A stored Expectation, named by its id.
    Stored,
    /// The wait a stored Asynchronous Task spawned, named by the Task's id.
    Spawned,
    /// The wait a Habit occurrence spawned, named by the occurrence's node key.
    Occurrence,
}

impl WaitKind {
    /// The spelling `wait_checks.wait_kind` stores.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stored => "stored",
            Self::Spawned => "spawned",
            Self::Occurrence => "occurrence",
        }
    }
}

/// One wait, as the checks on it name it: a stored Expectation, the wait a stored Task spawned,
/// or the wait a Habit occurrence spawned.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum WaitRef {
    /// A stored Expectation.
    Stored(i64),
    /// The wait a stored Task spawned, by the Task.
    Spawned(i64),
    /// The wait a Habit occurrence spawned, by the occurrence's canonical node key.
    Occurrence(String),
}

impl WaitRef {
    /// Which kind of wait this is.
    pub fn kind(&self) -> WaitKind {
        match self {
            Self::Stored(_) => WaitKind::Stored,
            Self::Spawned(_) => WaitKind::Spawned,
            Self::Occurrence(_) => WaitKind::Occurrence,
        }
    }

    /// The `wait_checks` columns naming it: an integer id, or an occurrence's key.
    pub fn columns(&self) -> (Option<i64>, Option<&str>) {
        match self {
            Self::Stored(id) | Self::Spawned(id) => (Some(*id), None),
            Self::Occurrence(key) => (None, Some(key.as_str())),
        }
    }

    /// Its canonical spelling, `stored:5` / `spawned:5` / `occurrence:{node key}`.
    pub fn spelling(&self) -> String {
        match self {
            Self::Stored(id) | Self::Spawned(id) => format!("{}:{id}", self.kind().as_str()),
            Self::Occurrence(key) => format!("occurrence:{key}"),
        }
    }

    /// Parses [`Self::spelling`].
    pub fn parse(spelling: &str) -> Option<Self> {
        let (kind, rest) = spelling.split_once(':')?;
        match kind {
            "stored" => rest.parse().ok().map(Self::Stored),
            "spawned" => rest.parse().ok().map(Self::Spawned),
            "occurrence" => Some(Self::Occurrence(rest.to_string())),
            _ => None,
        }
    }
}
