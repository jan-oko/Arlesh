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

/// Which flow-item table a row lives in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlowItemType {
    /// A `flow_goals` row.
    FlowGoal,
    /// A `flow_tasks` row.
    FlowTask,
}

impl FlowItemType {
    /// The database string representation (`flow_goal` / `flow_task`).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FlowGoal => "flow_goal",
            Self::FlowTask => "flow_task",
        }
    }
}

/// Request body for updating a flow item (fields left `None` are unchanged; `Some(None)` clears).
#[derive(Debug, Default, Deserialize)]
pub struct UpdateFlowItemRequest {
    /// New title.
    pub title: Option<String>,
    /// New in-flow parent type (with parent_id).
    pub parent_type: Option<String>,
    /// New in-flow parent id (with parent_type).
    pub parent_id: Option<i64>,
    /// New sort position.
    pub position: Option<i64>,
}

/// A relative (Cycle Scope, Cycle Plan) pair carried by a flow item.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FlowItemCycle {
    /// Primary key.
    pub id: i64,
    /// Owning flow.
    pub flow_id: i64,
    /// Which flow-item table the owner lives in (`flow_goal` / `flow_task`).
    pub item_type: String,
    /// Owning flow-item id.
    pub item_id: i64,
    /// Cycle-scope subkind (NULL = the whole flow scope).
    pub scope_kind: Option<String>,
    /// 1-based index of the cycle scope within the flow window.
    pub scope_index: Option<i64>,
    /// Cycle-plan subkind within the cycle scope (NULL = no plan).
    pub plan_kind: Option<String>,
    /// 1-based inclusive start of the cycle-plan range within the cycle scope.
    pub plan_start: Option<i64>,
    /// 1-based inclusive end of the cycle-plan range within the cycle scope.
    pub plan_end: Option<i64>,
    /// Sort position among the item's pairs.
    pub position: i64,
}

/// One (Cycle Scope, Cycle Plan) pair to persist for a flow item.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct FlowCycleInput {
    /// Cycle-scope subkind (None = the whole flow scope).
    #[serde(default)]
    pub scope_kind: Option<String>,
    /// 1-based index of the cycle scope within the flow window.
    #[serde(default)]
    pub scope_index: Option<i64>,
    /// Cycle-plan subkind (None = no plan).
    #[serde(default)]
    pub plan_kind: Option<String>,
    /// 1-based inclusive start of the cycle-plan range.
    #[serde(default)]
    pub plan_start: Option<i64>,
    /// 1-based inclusive end of the cycle-plan range.
    #[serde(default)]
    pub plan_end: Option<i64>,
}

/// Request body for starting a flow (materialising it under a target).
#[derive(Debug, Deserialize)]
pub struct StartFlowRequest {
    /// Title of the materialised root node.
    pub title: String,
    /// Target parent type the root is created under (`aspect`/`project`/`domain`/`goal`/`task`).
    pub target_type: String,
    /// Target parent id.
    pub target_id: i64,
    /// A date within the anchor scope of the flow's kind (the window's first period).
    pub anchor_date: chrono::NaiveDate,
}

/// The outcome of starting a flow: the materialised root node.
#[derive(Debug, Clone, Serialize)]
pub struct MaterializedFlow {
    /// Root node kind (`goal` or `task`).
    pub root_type: String,
    /// Root node id.
    pub root_id: i64,
}

/// A candidate target node for a flow, referenced by kind and id. Used by the target-picker
/// scope-validity check and the flow-origin lookup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TargetRef {
    /// Node kind (`aspect`/`domain`/`project`/`goal`/`task`).
    pub node_type: String,
    /// Node id.
    pub node_id: i64,
}

/// A materialised node's originating flow: which real node it is and the flow it was started from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FlowOrigin {
    /// The real node's kind (`goal` / `task`).
    pub node_type: String,
    /// The real node's id.
    pub node_id: i64,
    /// Title of the flow this node was materialised from.
    pub flow_title: String,
}

/// An intra-flow dependency: `dependent` waits on `depends_on`.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FlowDependency {
    /// Primary key.
    pub id: i64,
    /// Owning flow.
    pub flow_id: i64,
    /// The waiting item's type (`flow_goal` / `flow_task`).
    pub dependent_type: String,
    /// The waiting item's id.
    pub dependent_id: i64,
    /// The blocking item's type.
    pub depends_on_type: String,
    /// The blocking item's id.
    pub depends_on_id: i64,
}

/// How a Habit treats unfinished instances as their iterations pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsumptionKind {
    /// Unfinished instances are archived once their iteration passes.
    Destructive,
    /// Unfinished instances survive past their iteration.
    Accumulating,
}

impl ConsumptionKind {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Destructive => "destructive",
            Self::Accumulating => "accumulating",
        }
    }
}

/// Whether an Accumulating Habit keeps generating iterations while unresolved instances exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockingMode {
    /// New iterations generate regardless of unresolved instances.
    Overlapping,
    /// New iterations are withheld while unresolved instances exist.
    Blocking,
}

impl BlockingMode {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Overlapping => "overlapping",
            Self::Blocking => "blocking",
        }
    }
}

/// When a Blocking Habit's open iteration completes, how it advances.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatchupPolicy {
    /// Generate every missed iteration, in order.
    AllPending,
    /// Advance by a single iteration.
    Next,
    /// Jump to the current iteration, recording skipped ones as missed tombstones.
    Latest,
}

impl CatchupPolicy {
    /// The database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AllPending => "all_pending",
            Self::Next => "next",
            Self::Latest => "latest",
        }
    }
}

/// A Habit's Recurrence: Repetition (Start, optional Gap, optional end) plus the Consumption config.
/// Its presence marks the owning flow as a Habit. Consumption fields follow the tree — `blocking_mode`
/// is set iff Accumulating, `catchup_policy` iff Blocking.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FlowRecurrence {
    /// Owning flow (also the primary key — one recurrence per flow).
    pub flow_id: i64,
    /// The scope the recurrence starts on (of the flow's Duration kind).
    pub start_scope_id: i64,
    /// Idle span between one iteration window's end and the next's start; `None` = continuous.
    pub gap_n: Option<i64>,
    /// Kind of the Gap span (`day`/`week`/`month`/`season`); travels with `gap_n`.
    pub gap_kind: Option<String>,
    /// Optional end scope; `None` = open-ended.
    pub end_scope_id: Option<i64>,
    /// Destructive vs Accumulating.
    pub consumption_kind: String,
    /// Overlapping vs Blocking (set iff Accumulating).
    pub blocking_mode: Option<String>,
    /// Catch-up policy (set iff Blocking).
    pub catchup_policy: Option<String>,
}

/// Request to set (create or replace) a flow's Recurrence, making it a Habit.
#[derive(Debug, Clone, Deserialize)]
pub struct SetRecurrenceRequest {
    /// The scope the recurrence starts on (of the flow's Duration kind).
    pub start_scope_id: i64,
    /// Gap magnitude; `None` = continuous (no gap).
    pub gap_n: Option<i64>,
    /// Gap kind; must accompany `gap_n` and be no finer than the flow's Duration kind.
    pub gap_kind: Option<String>,
    /// Optional end scope; `None` = open-ended.
    pub end_scope_id: Option<i64>,
    /// Destructive vs Accumulating.
    pub consumption_kind: ConsumptionKind,
    /// Overlapping vs Blocking; required iff Accumulating.
    pub blocking_mode: Option<BlockingMode>,
    /// Catch-up policy; required iff Blocking.
    pub catchup_policy: Option<CatchupPolicy>,
}

/// The derived state of a Habit iteration on a given day (nothing is persisted — see the pure
/// classifier in `flows::habits`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IterationStatus {
    /// Open and awaiting completion.
    Active,
    /// Every instance in the iteration is complete.
    Done,
    /// Passed unfinished under a Destructive habit.
    Archived,
    /// Skipped by a Blocking `latest` catch-up.
    Missed,
}

/// One derived Habit iteration: its ordinal, the scope anchoring its window, and current state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HabitIteration {
    /// Zero-based ordinal from the Repetition Start.
    pub index: i64,
    /// The scope anchoring the iteration window's first period (also the instance overlay key).
    pub anchor_scope_id: i64,
    /// The window's first day, ISO `YYYY-MM-DD` (drives the `{flow title} {start scope}` title).
    pub anchor_date: String,
    /// Derived state on the reference day.
    pub status: IterationStatus,
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

    #[test]
    fn consumption_enums_cover_all_variants() {
        assert_eq!(ConsumptionKind::Destructive.as_str(), "destructive");
        assert_eq!(ConsumptionKind::Accumulating.as_str(), "accumulating");
        assert_eq!(BlockingMode::Overlapping.as_str(), "overlapping");
        assert_eq!(BlockingMode::Blocking.as_str(), "blocking");
        assert_eq!(CatchupPolicy::AllPending.as_str(), "all_pending");
        assert_eq!(CatchupPolicy::Next.as_str(), "next");
        assert_eq!(CatchupPolicy::Latest.as_str(), "latest");
    }
}
