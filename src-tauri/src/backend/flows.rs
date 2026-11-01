//! The `flows` part of the [`Backend`](super::Backend) port: what the commands in
//! [`crate::commands::flows`] ask of whichever backend the app runs on.

use crate::{
    error::WireError,
    flows::{
        self,
        model::{
            CreateFlowItemRequest, CreateFlowRequest, Flow, FlowCommitment, FlowCycleInput,
            FlowDependency, FlowExpectation, FlowGoal, FlowItemCycle, FlowItemType, FlowOrigin,
            FlowRecurrence, FlowTask, MaterializedFlow, SetRecurrenceRequest, StartFlowRequest,
            TargetRef, UpdateFlowItemRequest, UpdateFlowRequest,
        },
    },
};

/// The `flows` operations a backend serves.
#[async_trait::async_trait]
pub trait FlowsPort: Send + Sync {
    /// Creates a new flow.
    async fn create_flow(&self, request: CreateFlowRequest) -> Result<Flow, WireError>;

    /// Fetches a flow by id.
    async fn get_flow(&self, id: i64) -> Result<Flow, WireError>;

    /// Lists all flows.
    async fn list_flows(&self) -> Result<Vec<Flow>, WireError>;

    /// Updates a flow.
    async fn update_flow(&self, id: i64, request: UpdateFlowRequest) -> Result<Flow, WireError>;

    /// Deletes a flow (and its items).
    async fn delete_flow(&self, id: i64) -> Result<(), WireError>;

    /// Creates a flow-goal item.
    async fn create_flow_goal(&self, request: CreateFlowItemRequest)
        -> Result<FlowGoal, WireError>;

    /// Creates a flow-task item.
    async fn create_flow_task(&self, request: CreateFlowItemRequest)
        -> Result<FlowTask, WireError>;

    /// Creates a flow **Commitment** item.
    async fn create_flow_commitment(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowCommitment, WireError>;

    /// Creates a flow **wait** item.
    async fn create_flow_expectation(
        &self,
        request: CreateFlowItemRequest,
    ) -> Result<FlowExpectation, WireError>;

    /// Updates a flow **Commitment** item.
    async fn update_flow_commitment(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowCommitment, WireError>;

    /// Updates a flow **wait** item.
    async fn update_flow_expectation(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowExpectation, WireError>;

    /// Lists a flow's goal items.
    async fn list_flow_goals(&self, flow_id: i64) -> Result<Vec<FlowGoal>, WireError>;

    /// Lists a flow's task items.
    async fn list_flow_tasks(&self, flow_id: i64) -> Result<Vec<FlowTask>, WireError>;

    /// Lists every flow's goal items.
    async fn list_all_flow_goals(&self) -> Result<Vec<FlowGoal>, WireError>;

    /// Lists every flow's task items.
    async fn list_all_flow_tasks(&self) -> Result<Vec<FlowTask>, WireError>;

    /// Updates a flow-goal item.
    async fn update_flow_goal(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowGoal, WireError>;

    /// Updates a flow-task item.
    async fn update_flow_task(
        &self,
        id: i64,
        request: UpdateFlowItemRequest,
    ) -> Result<FlowTask, WireError>;

    /// Starts a flow, materialising it into a real subtree under the target.
    async fn start_flow(
        &self,
        flow_id: i64,
        request: StartFlowRequest,
    ) -> Result<MaterializedFlow, WireError>;

    /// Returns the subset of `candidates` a flow of the given duration may validly target. With a
    async fn scope_valid_flow_targets(
        &self,
        duration_n: Option<i64>,
        duration_kind: Option<String>,
        anchor_date: Option<chrono::NaiveDate>,
        candidates: Vec<TargetRef>,
    ) -> Result<Vec<TargetRef>, WireError>;

    /// Sets (creates or replaces) a flow's Recurrence, making it a Habit.
    async fn set_flow_recurrence(
        &self,
        flow_id: i64,
        request: SetRecurrenceRequest,
    ) -> Result<FlowRecurrence, WireError>;

    /// Fetches a flow's Recurrence, or `null` if it is a plain (non-habit) flow.
    async fn get_flow_recurrence(&self, flow_id: i64) -> Result<Option<FlowRecurrence>, WireError>;

    /// Deletes a flow's Recurrence, demoting the Habit back to a plain flow.
    async fn delete_flow_recurrence(&self, flow_id: i64) -> Result<(), WireError>;

    /// For each of `nodes` that was materialised from a flow, returns its originating flow title.
    async fn flow_origins(&self, nodes: Vec<TargetRef>) -> Result<Vec<FlowOrigin>, WireError>;

    /// Every real node materialised by a started flow, for the mindmap's flow-instance badge.
    async fn list_flow_instance_nodes(&self) -> Result<Vec<TargetRef>, WireError>;

    /// Deletes a flow item (goal or task) and its cycles and dependency links.
    async fn delete_flow_item(&self, item_type: FlowItemType, id: i64) -> Result<(), WireError>;

    /// Saves a flow item's cycle pairs, keeping every pair that survives. A change that would orphan
    async fn set_flow_item_cycles(
        &self,
        flow_id: i64,
        item_type: FlowItemType,
        item_id: i64,
        cycles: Vec<FlowCycleInput>,
        reconcile: Option<flows::cycles::Reconcile>,
        now: Option<chrono::NaiveDateTime>,
    ) -> Result<Option<flows::cycles::ForkedTemplate>, WireError>;

    /// Lists every flow's cycle pairs.
    async fn list_all_flow_cycles(&self) -> Result<Vec<FlowItemCycle>, WireError>;

    /// Adds an intra-flow dependency (`dependent` waits on `depends_on`).
    async fn add_flow_dependency(
        &self,
        flow_id: i64,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), WireError>;

    /// Removes an intra-flow dependency.
    async fn remove_flow_dependency(
        &self,
        dependent_type: FlowItemType,
        dependent_id: i64,
        depends_on_type: FlowItemType,
        depends_on_id: i64,
    ) -> Result<(), WireError>;

    /// Lists every flow's dependencies.
    async fn list_all_flow_dependencies(&self) -> Result<Vec<FlowDependency>, WireError>;

    /// Number of distinct completed iterations of a Habit (divergence detection for reconciliation).
    async fn habit_completion_count(&self, flow_id: i64) -> Result<i64, WireError>;

    /// Clears every Habit Modification for a flow (delete-and-regenerate reconciliation).
    async fn clear_habit_modifications(&self, flow_id: i64) -> Result<(), WireError>;

    /// The archive-and-new reconciliation arm: deep-clones a flow's template into a new flow and
    async fn fork_flow(&self, flow_id: i64, now: chrono::NaiveDateTime) -> Result<Flow, WireError>;

    /// Copies a Flow — template, Recurrence and all — under a new parent (the Mindmap's Copy+Paste).
    async fn duplicate_flow(
        &self,
        flow_id: i64,
        parent_type: String,
        parent_id: i64,
        position: i64,
    ) -> Result<Flow, WireError>;

    /// Copies a flow item (and its nested items) within its own template. Returns the new item's id.
    async fn duplicate_flow_item(
        &self,
        item_type: FlowItemType,
        item_id: i64,
        parent_type: String,
        parent_id: i64,
        position: i64,
    ) -> Result<i64, WireError>;

    /// Converts a real Task/Goal subtree into a Flow template of the same Instance Type.
    async fn convert_to_flow(
        &self,
        node_type: String,
        node_id: i64,
        keep_dependencies: bool,
        map_scopes: bool,
    ) -> Result<Flow, WireError>;
}
