//! The mindmap load envelope: every payload one mindmap render needs, in one value.

use serde::Serialize;

use crate::{
    block_reasons::model::BlockReason,
    domains::model::Domain,
    flows::model::{
        Flow, FlowDependency, FlowGoal, FlowItemCycle, FlowTask, HabitInstanceChild,
        HabitIteration, HabitItemStatus, TargetRef,
    },
    infos::model::Info,
    tasks::{
        lifecycle::ItemLifecycle,
        model::{Commitment, Goal, Task, TaskDependencyEdge},
    },
};

/// One flow's Habit payload, or the failure that stood in for it.
///
/// Serialises as a union discriminated on `outcome`, so the frontend narrows on that tag rather
/// than sniffing for present fields.
///
/// The two payload halves travel together because they are consumed together: a flow's
/// iterations are rendered coloured by its per-instance statuses, so there is nothing honest to
/// draw from one when the other is missing.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum FlowHabitResult {
    /// Both derivations succeeded. A flow that is not a Habit loads as this variant with an
    /// empty `iterations`: "no recurrence configured" is an answer, not a failure.
    Loaded {
        /// The flow's derived iterations — empty for a non-Habit.
        iterations: Vec<HabitIteration>,
        /// The flow's divergent per-instance statuses.
        statuses: Vec<HabitItemStatus>,
    },
    /// A derivation failed. This flow's instances are missing from the load, and the frontend
    /// says so rather than drawing an empty Habit as though it had no iterations.
    Failed {
        /// Human-readable description of what went wrong, for the user-facing notice.
        message: String,
    },
}

/// One flow's Habit payload, tagged with the flow it belongs to.
///
/// Entries are in the same order as [`MindmapLoad::flows`]; `flow_id` is carried anyway so a
/// consumer can key by it instead of trusting position.
#[derive(Debug, Clone, Serialize)]
pub struct FlowHabitEntry {
    /// The flow this entry describes.
    pub flow_id: i64,
    /// The flow's title, so a failure notice can name it without a second lookup.
    pub flow_title: String,
    /// The payload, or the failure that replaced it.
    pub result: FlowHabitResult,
}

/// Everything one mindmap render reads, gathered in a single command round trip.
///
/// Each field is exactly what the equivalent single-resource command returns; this type adds no
/// derived or assembled data. Tree assembly stays in the frontend (see the Phase 6 scope note in
/// `docs/superpowers/plans/2026-09-13-backend-architecture-foundations.md`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MindmapLoad {
    /// Aspects, projects, domains and tags — as `list_domains(None)`.
    pub domains: Vec<Domain>,
    /// Every goal — as `list_goals`.
    pub goals: Vec<Goal>,
    /// Every task — as `list_tasks`.
    pub tasks: Vec<Task>,
    /// Every commitment — as `list_commitments`.
    pub commitments: Vec<Commitment>,
    /// Every info node — as `list_infos`.
    pub infos: Vec<Info>,
    /// Every flow — as `list_flows`.
    pub flows: Vec<Flow>,
    /// Every flow's goal items — as `list_all_flow_goals`.
    pub flow_goals: Vec<FlowGoal>,
    /// Every flow's task items — as `list_all_flow_tasks`.
    pub flow_tasks: Vec<FlowTask>,
    /// Every flow's cycle pairs — as `list_all_flow_cycles`.
    pub flow_cycles: Vec<FlowItemCycle>,
    /// Every flow's intra-flow dependencies — as `list_all_flow_dependencies`.
    pub flow_dependencies: Vec<FlowDependency>,
    /// Every block reason across tasks and goals — as `list_all_block_reasons`.
    pub block_reasons: Vec<BlockReason>,
    /// Every task dependency edge — as `list_all_task_dependencies`.
    pub task_dependencies: Vec<TaskDependencyEdge>,
    /// Every real node materialised by a started flow — as `list_flow_instance_nodes`.
    pub flow_instance_nodes: Vec<TargetRef>,
    /// Every task's, goal's and commitment's derived lifecycle at `now` — as
    /// `derive_scope_lifecycles`.
    pub lifecycles: Vec<ItemLifecycle>,
    /// One entry per flow, in `flows` order — the dependent wave, resolved backend-side.
    pub habits: Vec<FlowHabitEntry>,
    /// Every node attached to a virtual Habit occurrence — as `list_all_habit_instance_children`.
    ///
    /// The attachments only, not the nodes: an added child is an ordinary Task, Goal, Commitment
    /// or Info and already travels in its own list above. What this says is which occurrence each
    /// one hangs on, which is the one thing its own row cannot.
    pub habit_instance_children: Vec<HabitInstanceChild>,
}
