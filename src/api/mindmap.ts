import { invoke } from "./gesture";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { Task, TaskDependencyEdge } from "@/api/tasks";
import type { Commitment } from "@/api/commitments";
import type { Info } from "@/api/infos";
import type { BlockReason } from "@/api/block-reasons";
import type {
  Flow, FlowGoal, FlowTask, FlowItemCycle, FlowDependency,
  HabitInstanceChild, HabitIteration, HabitItemStatus, TargetRef,
} from "@/api/flows";
import type { ItemLifecycle } from "@/api/scope-lifecycle";

/**
 * One flow's Habit payload, or the failure that stood in for it. Discriminated on `outcome`,
 * so narrowing needs no type assertion.
 *
 * A flow that is not a Habit is `loaded` with an empty `iterations` — "no recurrence configured"
 * is an answer, not a failure, and treating it as one would raise a notice about every ordinary
 * flow on every load.
 */
export type FlowHabitResult =
  | { outcome: "loaded"; iterations: HabitIteration[]; statuses: HabitItemStatus[] }
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
 * Everything one mindmap render reads. Each field is what the equivalent single-resource command
 * returns — the backend assembles nothing; the tree is still built in the frontend.
 */
export interface MindmapLoad {
  domains: Domain[];
  goals: Goal[];
  tasks: Task[];
  commitments: Commitment[];
  infos: Info[];
  flows: Flow[];
  flow_goals: FlowGoal[];
  flow_tasks: FlowTask[];
  flow_cycles: FlowItemCycle[];
  flow_dependencies: FlowDependency[];
  block_reasons: BlockReason[];
  task_dependencies: TaskDependencyEdge[];
  flow_instance_nodes: TargetRef[];
  lifecycles: ItemLifecycle[];
  /** One entry per flow, in `flows` order — the dependent wave, resolved backend-side. */
  habits: FlowHabitEntry[];
  /**
   * Which virtual Habit occurrence each added child hangs on. The children themselves arrive in
   * `tasks`/`goals`/`commitments`/`infos` like any other node; this is the attachment alone.
   */
  habit_instance_children: HabitInstanceChild[];
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

/** `entry.iterations` when it loaded, an empty list when it did not — positional, in flow order. */
export function habitIterations(habits: readonly FlowHabitEntry[]): HabitIteration[][] {
  return habits.map((entry) => (entry.result.outcome === "loaded" ? entry.result.iterations : []));
}

/** `entry.statuses` when it loaded, an empty list when it did not — positional, in flow order. */
export function habitStatuses(habits: readonly FlowHabitEntry[]): HabitItemStatus[][] {
  return habits.map((entry) => (entry.result.outcome === "loaded" ? entry.result.statuses : []));
}
