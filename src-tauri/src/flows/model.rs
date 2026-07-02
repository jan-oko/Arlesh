//! Flow (template) resource models.

use serde::{Deserialize, Serialize};

/// Identifies a flow row by its primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlowId(pub i64);

impl From<i64> for FlowId {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl From<FlowId> for i64 {
    fn from(id: FlowId) -> Self {
        id.0
    }
}

/// What a Flow's root (and children) materialize as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstanceType {
    /// Materializes as a Goal subtree.
    Goal,
    /// Materializes as a Task subtree.
    Task,
}

impl InstanceType {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Goal => "goal",
            Self::Task => "task",
        }
    }
}

/// A flow (template) row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Flow {
    /// Primary key.
    pub id: i64,
    /// Display title.
    pub title: String,
    /// What instances materialize as (`goal` or `task`).
    pub instance_type: String,
    /// Parent entity type (`aspect`/`project`/`domain`/`goal`).
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Default target node type for instances (if set).
    pub target_type: Option<String>,
    /// Default target node id for instances (if set).
    pub target_id: Option<i64>,
    /// Flow-scope duration count (relative; anchored on start).
    pub flow_duration_n: Option<i64>,
    /// Flow-scope duration kind (e.g. "week").
    pub flow_duration_kind: Option<String>,
    /// Sort position among siblings.
    pub position: i64,
}

/// A flow-goal (template item) row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FlowGoal {
    /// Primary key.
    pub id: i64,
    /// Owning flow.
    pub flow_id: i64,
    /// Display title.
    pub title: String,
    /// In-flow parent type (`flow` or `flow_goal`).
    pub parent_type: String,
    /// In-flow parent id (the flow, or a flow item).
    pub parent_id: i64,
    /// Default status of materialized instances.
    pub status: String,
    /// Explicit block reason template (if any).
    pub blocked_reason: Option<String>,
    /// Sort position among siblings.
    pub position: i64,
}

/// A flow-task (template item) row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FlowTask {
    /// Primary key.
    pub id: i64,
    /// Owning flow.
    pub flow_id: i64,
    /// Display title.
    pub title: String,
    /// In-flow parent type (`flow`, `flow_goal`, or `flow_task`).
    pub parent_type: String,
    /// In-flow parent id (the flow, or a flow item).
    pub parent_id: i64,
    /// Default status of materialized instances.
    pub status: String,
    /// Explicit block reason template (if any).
    pub blocked_reason: Option<String>,
    /// Sort position among siblings.
    pub position: i64,
}

/// Request body for creating a flow.
#[derive(Debug, Default, Deserialize)]
pub struct CreateFlowRequest {
    /// Display title.
    pub title: String,
    /// What instances materialize as.
    pub instance_type: Option<InstanceType>,
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: i64,
    /// Default target node type.
    #[serde(default)]
    pub target_type: Option<String>,
    /// Default target node id.
    #[serde(default)]
    pub target_id: Option<i64>,
    /// Flow-scope duration count.
    #[serde(default)]
    pub flow_duration_n: Option<i64>,
    /// Flow-scope duration kind.
    #[serde(default)]
    pub flow_duration_kind: Option<String>,
}

/// Request body for updating a flow (fields left `None` are unchanged; `Some(None)` clears).
#[derive(Debug, Default, Deserialize)]
pub struct UpdateFlowRequest {
    /// New title.
    pub title: Option<String>,
    /// New instance type.
    pub instance_type: Option<InstanceType>,
    /// Target node type (Some(None) clears).
    pub target_type: Option<Option<String>>,
    /// Target node id (Some(None) clears).
    pub target_id: Option<Option<i64>>,
    /// Flow-scope duration count (Some(None) clears).
    pub flow_duration_n: Option<Option<i64>>,
    /// Flow-scope duration kind (Some(None) clears).
    pub flow_duration_kind: Option<Option<String>>,
    /// New parent type (with parent_id).
    pub parent_type: Option<String>,
    /// New parent id (with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position.
    pub position: Option<i64>,
}

/// Request body for creating a flow item (goal or task).
#[derive(Debug, Default, Deserialize)]
pub struct CreateFlowItemRequest {
    /// Owning flow.
    pub flow_id: i64,
    /// Display title.
    pub title: String,
    /// In-flow parent type.
    pub parent_type: String,
    /// In-flow parent id.
    pub parent_id: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_type_as_str_covers_all_variants() {
        assert_eq!(InstanceType::Goal.as_str(), "goal");
        assert_eq!(InstanceType::Task.as_str(), "task");
    }

    #[test]
    fn flow_id_roundtrip() {
        assert_eq!(i64::from(FlowId::from(9_i64)), 9);
    }
}
