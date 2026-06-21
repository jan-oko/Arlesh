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

    /// Parses from the database string representation.
    pub fn parse_db(s: &str) -> Option<Self> {
        match s {
            "todo" => Some(Self::Todo),
            "in_progress" => Some(Self::InProgress),
            "done" => Some(Self::Done),
            _ => None,
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
    /// Scope this task is planned to (if any).
    pub scope_id: Option<i64>,
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
    /// Scope this goal is planned to (if any).
    pub scope_id: Option<i64>,
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
#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    /// Display title.
    pub title: String,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Initial status (defaults to Todo).
    pub status: Option<TaskStatus>,
    /// Initial scope assignment.
    pub scope_id: Option<i64>,
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
    /// Scope to plan to (None leaves unchanged, Some(None) clears it).
    pub scope_id: Option<Option<i64>>,
    /// New parent entity type for re-parenting (must be set together with parent_id).
    pub parent_type: Option<String>,
    /// New parent entity id for re-parenting (must be set together with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position among siblings (for sibling reordering).
    pub position: Option<i64>,
}

/// Request body for creating a goal.
#[derive(Debug, Deserialize)]
pub struct CreateGoalRequest {
    /// Display title.
    pub title: String,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Initial status (defaults to Active).
    pub status: Option<GoalStatus>,
    /// Initial scope assignment.
    pub scope_id: Option<i64>,
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
    /// Scope to plan to (None leaves unchanged, Some(None) clears it).
    pub scope_id: Option<Option<i64>>,
    /// New parent entity type for re-parenting (must be set together with parent_id).
    pub parent_type: Option<String>,
    /// New parent entity id for re-parenting (must be set together with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position among siblings (for sibling reordering).
    pub position: Option<i64>,
}
