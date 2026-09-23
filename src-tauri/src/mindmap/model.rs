//! The mindmap load envelope: every payload one mindmap render needs, in one value.

use serde::Serialize;

use crate::{
    block_reasons::model::BlockReason,
    domains::model::Domain,
    flows::model::{Flow, FlowDependency, FlowGoal, FlowItemCycle, FlowTask, TargetRef},
    infos::model::Info,
    tasks::{
        lifecycle::ItemLifecycle,
        model::{Commitment, Expectation, Goal, Task, TaskDependencyEdge},
        waits::{ExpectationCheck, SpawnedWaitView},
    },
};

/// Whether one flow's Habit occurrences were derived, or the failure that stood in for them.
///
/// Serialises as a union discriminated on `outcome`, so the frontend narrows on that tag rather
/// than sniffing for present fields. The occurrences themselves are not here: they are ordinary
/// rows of their kinds, and travel in [`MindmapLoad::tasks`], [`MindmapLoad::goals`] and
/// [`MindmapLoad::commitments`] beside the stored ones.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum FlowHabitResult {
    /// Derived — or not a Habit at all, which is an answer, not a failure.
    Loaded {},
    /// A derivation failed. This flow's occurrences are missing from the load, and the frontend
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
    /// Every goal, stored and derived — the Goal virtual table.
    pub goals: Vec<Goal>,
    /// Every task, stored and derived — the Task virtual table. A Habit occurrence is one of
    /// these like any other, told apart only by its `origin`.
    pub tasks: Vec<Task>,
    /// Every commitment, stored and derived — the Commitment virtual table.
    pub commitments: Vec<Commitment>,
    /// Every stored expectation — as `list_expectations`. The virtual check tasks, the waits
    /// delegated and asynchronous tasks carry are derived from these rows, the task rows and the
    /// two lists below, never stored as expectations.
    pub expectations: Vec<Expectation>,
    /// Each stored expectation's next check, as the day its virtual check task is due.
    pub expectation_checks: Vec<ExpectationCheck>,
    /// Each Asynchronous task's spawned wait: the overlay, its Time Scope and its next check. The
    /// wait's title and tags are its task's template, which travels on the task.
    pub spawned_waits: Vec<SpawnedWaitView>,
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
    /// Every task's, goal's and commitment's derived lifecycle at `now`, derived rows included.
    pub lifecycles: Vec<ItemLifecycle>,
    /// One entry per flow, in `flows` order — the dependent wave, resolved backend-side.
    pub habits: Vec<FlowHabitEntry>,
}
