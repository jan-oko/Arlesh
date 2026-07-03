//! Task and Goal resource models.

use serde::{Deserialize, Serialize};

/// Identifies a task row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskId(pub i64);

impl From<i64> for TaskId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<TaskId> for i64 {
    fn from(id: TaskId) -> Self {
        id.0
    }
}

/// Identifies a goal row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalId(pub i64);

impl From<i64> for GoalId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<GoalId> for i64 {
    fn from(id: GoalId) -> Self {
        id.0
    }
}

/// Task lifecycle status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// Not yet started.
    Todo,
    /// Currently being worked on.
    InProgress,
    /// Completed.
    Done,
}

impl TaskStatus {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Done => "done",
        }
    }

}

/// Goal lifecycle status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    /// Actively being pursued.
    Active,
    /// Successfully achieved.
    Achieved,
    /// Temporarily paused.
    Frozen,
    /// No longer relevant.
    Archived,
}

impl GoalStatus {
    /// Returns the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Achieved => "achieved",
            Self::Frozen => "frozen",
            Self::Archived => "archived",
        }
    }
}

/// What happens to a scoped item once its Time Scope has fully passed while still unfinished.
/// The single-occurrence form of a Habit's Consumption root.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnScopeExit {
    /// The item **Lapses** — drops out of the active view.
    Archive,
    /// The item stays, flagged **Overdue**.
    Keep,
}

impl OnScopeExit {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Archive => "archive",
            Self::Keep => "keep",
        }
    }

    /// Parses the database string representation, if recognized.
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "archive" => Some(Self::Archive),
            "keep" => Some(Self::Keep),
            _ => None,
        }
    }
}

/// The Duration parameters of a Time Scope, retained after snapshotting so the UI can keep
/// presenting and editing the scope in duration form.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DurationSpec {
    /// Number of scope-kind units (e.g. 3 in "3 weeks").
    pub n: i64,
    /// The scope kind the duration is expressed in (e.g. "week").
    pub kind: String,
}

/// An item's relevance window: a resolved boundaries `[start, end]` scope range (equal ids
/// denote a single scope), optionally tagged with the Duration parameters it came from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TimeScope {
    /// Start boundary scope id.
    pub start_id: i64,
    /// End boundary scope id.
    pub end_id: i64,
    /// Duration parameters, when the scope was set in duration form.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<DurationSpec>,
}

/// A task row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Type of the parent entity.
    pub parent_type: String,
    /// Id of the parent entity.
    pub parent_id: i64,
    /// Current status.
    pub status: String,
    /// Explicit block reason (if set).
    pub blocked_reason: Option<String>,
    /// Person id this task is delegated to (if any).
    pub delegate_to: Option<i64>,
    /// Relevance window (if set). A null value inherits the nearest scoped ancestor.
    pub time_scope: Option<TimeScope>,
    /// On-exit behavior; present iff `time_scope` is (inherited with the window otherwise).
    pub on_scope_exit: Option<OnScopeExit>,
    /// Scheduling window this task is planned into (if any). Must be contained in `time_scope`.
    pub plan: Option<TimeScope>,
    /// Tag domain ids attached to this task.
    pub tag_ids: Vec<i64>,
    /// Sort position among siblings; defaults to id (insertion order).
    pub position: i64,
}

/// A task row enriched with virtual block information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskWithBlockers {
    /// The base task.
    pub task: Task,
    /// All block reasons (explicit + virtual from dependencies).
    pub block_reasons: Vec<String>,
}

/// A goal row as returned from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// Type of the parent entity.
    pub parent_type: String,
    /// Id of the parent entity.
    pub parent_id: i64,
    /// Current status.
    pub status: String,
    /// Explicit block reason (if set).
    pub blocked_reason: Option<String>,
    /// Relevance window (if set). A null value inherits the nearest scoped ancestor.
    pub time_scope: Option<TimeScope>,
    /// On-exit behavior; present iff `time_scope` is (inherited with the window otherwise).
    pub on_scope_exit: Option<OnScopeExit>,
    /// Tag domain ids attached to this goal.
    pub tag_ids: Vec<i64>,
    /// Sort position among siblings; defaults to id (insertion order).
    pub position: i64,
}

/// Dependency reference: either a task or a goal.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Dependency {
    /// Depends on another task.
    Task {
        /// The task being depended on.
        id: i64,
    },
    /// Depends on a goal being achieved.
    Goal {
        /// The goal being depended on.
        id: i64,
    },
}

/// Request body for creating a task.
#[derive(Debug, Default, Deserialize)]
pub struct CreateTaskRequest {
    /// Display title.
    pub title: String,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Initial status (defaults to Todo).
    pub status: Option<TaskStatus>,
    /// Initial relevance window.
    #[serde(default)]
    pub time_scope: Option<TimeScope>,
    /// On-exit behavior; applied only when `time_scope` is set (defaults to Keep).
    #[serde(default)]
    pub on_scope_exit: Option<OnScopeExit>,
    /// Initial Plan (scheduling window).
    #[serde(default)]
    pub plan: Option<TimeScope>,
}

/// Request body for updating a task.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateTaskRequest {
    /// New title (if provided).
    pub title: Option<String>,
    /// New status (if provided).
    pub status: Option<TaskStatus>,
    /// Explicit block reason to set or clear.
    pub blocked_reason: Option<String>,
    /// Person to delegate to (None leaves unchanged, Some(None) clears it).
    pub delegate_to: Option<Option<i64>>,
    /// Relevance window to set (None leaves unchanged, Some(None) clears it).
    pub time_scope: Option<Option<TimeScope>>,
    /// On-exit behavior to set (None leaves unchanged); forced NULL when the scope is cleared,
    /// defaulted to Keep when a scope is set without one.
    pub on_scope_exit: Option<Option<OnScopeExit>>,
    /// Plan window to set (None leaves unchanged, Some(None) clears it).
    pub plan: Option<Option<TimeScope>>,
    /// New parent entity type for re-parenting (must be set together with parent_id).
    pub parent_type: Option<String>,
    /// New parent entity id for re-parenting (must be set together with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position among siblings (for sibling reordering).
    pub position: Option<i64>,
}

/// Request body for creating a goal.
#[derive(Debug, Default, Deserialize)]
pub struct CreateGoalRequest {
    /// Display title.
    pub title: String,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Initial status (defaults to Active).
    pub status: Option<GoalStatus>,
    /// Initial relevance window.
    #[serde(default)]
    pub time_scope: Option<TimeScope>,
    /// On-exit behavior; applied only when `time_scope` is set (defaults to Keep).
    #[serde(default)]
    pub on_scope_exit: Option<OnScopeExit>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_status_as_str_covers_all_variants() {
        assert_eq!(TaskStatus::Todo.as_str(), "todo");
        assert_eq!(TaskStatus::InProgress.as_str(), "in_progress");
        assert_eq!(TaskStatus::Done.as_str(), "done");
    }

    #[test]
    fn goal_status_as_str_covers_all_variants() {
        assert_eq!(GoalStatus::Active.as_str(), "active");
        assert_eq!(GoalStatus::Achieved.as_str(), "achieved");
        assert_eq!(GoalStatus::Frozen.as_str(), "frozen");
        assert_eq!(GoalStatus::Archived.as_str(), "archived");
    }

    #[test]
    fn task_id_roundtrip() {
        let id = TaskId::from(7_i64);
        assert_eq!(i64::from(id), 7);
    }

    #[test]
    fn goal_id_roundtrip() {
        let id = GoalId::from(13_i64);
        assert_eq!(i64::from(id), 13);
    }
}

/// Request body for updating a goal.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateGoalRequest {
    /// New title (if provided).
    pub title: Option<String>,
    /// New status (if provided).
    pub status: Option<GoalStatus>,
    /// Explicit block reason to set or clear.
    pub blocked_reason: Option<String>,
    /// Relevance window to set (None leaves unchanged, Some(None) clears it).
    pub time_scope: Option<Option<TimeScope>>,
    /// On-exit behavior to set (None leaves unchanged); forced NULL when the scope is cleared,
    /// defaulted to Keep when a scope is set without one.
    pub on_scope_exit: Option<Option<OnScopeExit>>,
    /// New parent entity type for re-parenting (must be set together with parent_id).
    pub parent_type: Option<String>,
    /// New parent entity id for re-parenting (must be set together with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position among siblings (for sibling reordering).
    pub position: Option<i64>,
}
