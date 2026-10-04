import { invoke } from "./gesture";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { Task, TaskDependencyEdge } from "@/api/tasks";
import type { Commitment } from "@/api/commitments";
import type { Expectation } from "@/api/expectations";
import type { Info } from "@/api/infos";
import type { BlockReason } from "@/api/block-reasons";
import type {
  Flow, FlowGoal, FlowTask, FlowCommitment, FlowExpectation, FlowItemCycle, FlowDependency, TargetRef,
} from "@/api/flows";
import type { ItemLifecycle } from "@/api/scope-lifecycle";
import type { RowId } from "@/api/node-id";
import type { TimeScope } from "@/api/time-scope";

/** A dependency a Task is blocked by: its target, not Done, Achieved or released yet. */
export interface DependencyBlock {
  /** What is depended on. */
  kind: "task" | "goal" | "expectation";
  /** The target's row id. */
  id: RowId;
  /** The target's short id, when the board has one for it. */
  short_id?: string;
  /** The target's title. */
  title: string;
}

/**
 * What the board says about one node beyond its own row — worked out by the backend's rules, so
 * the app reads it rather than working it out (ADR 0010). Each field is absent at its default.
 */
export interface NodeFacts {
  /** Whether the node's ancestors read as Agentic: the nearest flag above it, else not. */
  inherited_agentic?: boolean;
  /** The Time Scope the node inherits: the nearest scoped ancestor's. */
  inherited_time_scope?: TimeScope;
  /** The Plan a Task takes from above: its parent's effective Plan, clipped to its own Time Scope.
   * Sent whether or not it has a Plan of its own — what it reads with none, and what an own Plan
   * must sit inside. */
  inherited_plan?: TimeScope;
  /** The node an inherited Plan comes from, keyed as the board keys it (`task-12`). */
  plan_source?: string;
  /** That node's short id. */
  plan_source_short_id?: string;
  /** The plan rule a Task breaks, as an undo or older data can leave one: its own Plan leaves the one it
   * inherits, or the Plan above it does not meet its window. */
  plan_conflict?: PlanConflict;
  /** The dependencies a Task is blocked by, in edge order. */
  dependency_blocks?: DependencyBlock[];
  /** The open agentic question beneath a Task — the wait that makes it read Review. */
  open_question?: RowId;
  /** Whether a Commitment's Verdict Window ran out before anything was recorded. */
  expired?: boolean;
  /** Whether this node, depended on, no longer holds its dependents back: a Task Done, a Goal
   * Achieved, a wait no longer pending. */
  met?: boolean;
  /** The title of the MCP root the node is seen through, when the MCP can see it. */
  mcp_visible_via?: string;
  /** What the row may be done to, when its origin turns anything off (a Habit occurrence, a
   * derived wait). Absent, everything is allowed. */
  capabilities?: NodeCapabilities;
}

/** A plan rule a Task breaks (`tasks::rules::plan_inheritance::PlanConflict`). */
export type PlanConflict = "parent_plan" | "empty";

/** What a row may be done to, as the backend decides it (`nodes::rules::capabilities`). */
export interface NodeCapabilities {
  delete: boolean;
  copy: boolean;
  drag: boolean;
  /** Whether a Task may be switched to Compound. */
  compound: boolean;
  /** Whether a Task may be given a prerequisite. */
  dependencies: boolean;
}

/** What the agents are doing on the whole board, counted, as the load sends it. */
export interface AgentActivityCounts {
  /** Agentic Tasks that read Review: On Agent, with the agent's question open for the user. */
  review: number;
  /** Pending agentic waits on something other than the user — CI, say. */
  waits: number;
  /** Agentic Tasks an agent holds, with nothing asked of the user: On Agent. */
  on_agent: number;
}

/**
 * Whether one flow's Habit occurrences were derived, or the failure that stood in for them.
 * Discriminated on `outcome`. The occurrences themselves are ordinary rows in `tasks`, `goals`
 * and `commitments`; a flow that is not a Habit simply loads with none.
 */
export type FlowHabitResult =
  | { outcome: "loaded" }
  | { outcome: "failed"; message: string };

/**
 * One flow's Habit payload, tagged with the flow it belongs to. Entries arrive in the same order
 * as `MindmapLoad.flows`; `flow_id` is carried anyway so a consumer can key by it.
 */
export interface FlowHabitEntry {
  flow_id: number;
  flow_title: string;
  result: FlowHabitResult;
}

/**
 * Everything one mindmap render reads. Each row list is what the equivalent single-resource
 * command returns; the tree is still built in the frontend. `facts` and `agent_activity` are what
 * the backend's rules say about the board beside the rows.
 */
export interface MindmapLoad {
  domains: Domain[];
  goals: Goal[];
  tasks: Task[];
  commitments: Commitment[];
  /** Every expectation, stored and derived — a Task's spawned wait and a delegated Task's wait
   * are rows here. A wait's check tasks are rows of `tasks`. */
  expectations: Expectation[];
  infos: Info[];
  flows: Flow[];
  flow_goals: FlowGoal[];
  flow_tasks: FlowTask[];
  flow_commitments: FlowCommitment[];
  flow_expectations: FlowExpectation[];
  flow_cycles: FlowItemCycle[];
  flow_dependencies: FlowDependency[];
  block_reasons: BlockReason[];
  task_dependencies: TaskDependencyEdge[];
  flow_instance_nodes: TargetRef[];
  lifecycles: ItemLifecycle[];
  /** One entry per flow, in `flows` order: whether its Habit occurrences were derived. */
  habits: FlowHabitEntry[];
  /** Each Task's, Goal's, Commitment's and wait's short id on the whole board, keyed `task-12` /
   * `expectation-3` — what a "Blocked by …" reason names its target by. */
  short_ids?: Record<string, string>;
  /** What the board says about each node beyond its row, keyed as `short_ids` is. */
  facts?: Record<string, NodeFacts>;
  /** What the agents are doing on the whole board. */
  agent_activity?: AgentActivityCounts;
}

/**
 * Loads the whole mindmap in one round trip, at `now` (a local wall-clock datetime, ISO
 * `YYYY-MM-DDTHH:MM:SS`).
 *
 * Replaces the `13 + 2N` calls this used to take for `N` flows — thirteen resource-wide lists
 * followed by a dependent wave of one iterations call and one statuses call per flow — a cost
 * paid again after every edit, since each mutation ends with a silent reload.
 *
 * One flow's Habit derivation failing does not fail the load: that flow's entry carries the
 * failure and everything else still arrives.
 */
export async function loadMindmap(now: string): Promise<MindmapLoad> {
  return invoke<MindmapLoad>("load_mindmap", { now });
}

