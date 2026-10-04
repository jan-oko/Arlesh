//! The mindmap load envelope: every payload one mindmap render needs, in one value.

use serde::Serialize;

use crate::{
    block_reasons::model::BlockReason,
    domains::model::Domain,
    flows::model::{Flow, FlowDependency, FlowGoal, FlowItemCycle, FlowTask, TargetRef},
    infos::model::Info,
    nodes::id::NodeId,
    tasks::{
        lifecycle::ItemLifecycle,
        model::{Commitment, Expectation, Goal, Task, TaskDependencyEdge, TimeScope},
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
    /// Every expectation, stored and derived — the Expectation virtual table: a Task's spawned
    /// wait and a delegated Task's wait are rows here, told apart by their `origin`. A wait's
    /// check tasks are rows of `tasks`.
    pub expectations: Vec<Expectation>,
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
    /// Each Task's, Goal's, Commitment's and wait's **short id** on the whole board, keyed as the
    /// board keys a node (`task-12`): what the app names a dependency it is blocked by with.
    /// Filled by the app's load only ([`crate::commands::mindmap::load_mindmap`]); empty, and left
    /// off the wire, everywhere else — the MCP names nodes among those it can see.
    #[serde(skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub short_ids: std::collections::HashMap<String, String>,
    /// What the board says about each node beyond its own row, keyed as [`Self::short_ids`] is:
    /// which of its dependencies block it, what it inherits, its open question, whether it has
    /// expired. Filled by the app's load only, as [`Self::short_ids`] is.
    #[serde(skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub facts: std::collections::HashMap<String, NodeFacts>,
    /// What the agents are doing on the whole board. Filled by the app's load only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_activity: Option<AgentActivity>,
    /// Every node's effective Plan and every plan rule the board breaks — what the app's facts,
    /// the MCP and the write guard read. Never sent as it is.
    #[serde(skip)]
    pub plans: super::rules::plans::PlanAudit,
}

/// A dependency a Task is blocked by: its target, which is not Done, Achieved or released yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DependencyBlock {
    /// What is depended on: `task`, `goal` or `expectation`.
    pub kind: String,
    /// The target's row id.
    pub id: NodeId,
    /// The target's short id, when the board has one for it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_id: Option<String>,
    /// The target's title.
    pub title: String,
}

/// What the board says about one node beyond its own row. Every field is left off the wire at
/// its default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct NodeFacts {
    /// Whether the node's ancestors read as Agentic — what it reads as when it has no flag of its
    /// own: the nearest flag above it, else not.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub inherited_agentic: bool,
    /// The Time Scope the node inherits: the nearest scoped ancestor's, when it has none of its
    /// own to replace it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inherited_time_scope: Option<TimeScope>,
    /// The Plan the node takes from above: its parent's effective Plan, clipped to its own Time
    /// Scope. Sent whether or not it has a Plan of its own — it is what it reads when it has none,
    /// and what an own Plan must sit inside.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inherited_plan: Option<TimeScope>,
    /// The node whose own Plan [`Self::inherited_plan`] comes from, keyed as the board keys it —
    /// or, for a node whose inherited Plan came to nothing, the node it would have come from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_source: Option<String>,
    /// [`Self::plan_source`]'s short id, when the board has one for it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_source_short_id: Option<String>,
    /// The plan rule a Task breaks — one that arose outside the writer, as an undo or older data
    /// can leave; the guard never lets a write leave one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_conflict: Option<crate::tasks::rules::plan_inheritance::PlanConflict>,
    /// The dependencies a Task is blocked by, in edge order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub dependency_blocks: Vec<DependencyBlock>,
    /// The open agentic question beneath a Task — the wait that makes it read Review.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_question: Option<NodeId>,
    /// Whether a Commitment's Verdict Window ran out before anything was recorded.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub expired: bool,
    /// Whether this node, depended on, no longer holds its dependents back: a Task Done, a Goal
    /// Achieved, a wait no longer pending.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub met: bool,
    /// The title of the MCP root the node is seen through, when the MCP can see it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_visible_via: Option<String>,
    /// What the row may be done to, when its origin turns anything off — a Habit occurrence, a
    /// derived wait ([`crate::nodes::rules::capabilities`]). Absent, everything is allowed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<crate::nodes::rules::capabilities::Capabilities>,
}

/// What the agents are doing on the whole board, counted.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct AgentActivity {
    /// Agentic Tasks that read Review: On Agent, with the agent's question open for the user.
    pub review: usize,
    /// Pending, live agentic waits on something other than the user — CI, say.
    pub waits: usize,
    /// Agentic Tasks an agent holds, with nothing asked of the user: On Agent.
    pub on_agent: usize,
}
