import { invoke } from "@tauri-apps/api/core";

export type InstanceType = "goal" | "task";

/** A flow (template), mirrored from the Rust `flows::model::Flow`. */
export interface Flow {
  id: number;
  title: string;
  instance_type: InstanceType;
  parent_type: string;
  parent_id: number;
  target_type: string | null;
  target_id: number | null;
  flow_duration_n: number | null;
  // Span ("day"|"week"|"month"|"season") or Phase ("part"|"exact").
  flow_duration_kind: string | null;
  // Phase-"part" band (e.g. "evening"); set iff kind is "part".
  flow_window_part: string | null;
  // Phase-"exact" time-of-day range "HH:MM"; set iff kind is "exact".
  flow_window_time_start: string | null;
  flow_window_time_end: string | null;
  position: number;
}

export interface CreateFlowRequest {
  title: string;
  instance_type?: InstanceType;
  parent_type: string;
  parent_id: number;
  target_type?: string | null;
  target_id?: number | null;
  flow_duration_n?: number | null;
  flow_duration_kind?: string | null;
  flow_window_part?: string | null;
  flow_window_time_start?: string | null;
  flow_window_time_end?: string | null;
}

export interface UpdateFlowRequest {
  title?: string;
  instance_type?: InstanceType;
  // Absent = leave unchanged, null = clear, value = set.
  target_type?: string | null;
  target_id?: number | null;
  flow_duration_n?: number | null;
  flow_duration_kind?: string | null;
  flow_window_part?: string | null;
  flow_window_time_start?: string | null;
  flow_window_time_end?: string | null;
  parent_type?: string;
  parent_id?: number;
  position?: number;
}

export async function listFlows(): Promise<Flow[]> {
  return invoke<Flow[]>("list_flows");
}

export async function getFlow(id: number): Promise<Flow> {
  return invoke<Flow>("get_flow", { id });
}

export async function createFlow(request: CreateFlowRequest): Promise<Flow> {
  return invoke<Flow>("create_flow", { request });
}

export async function updateFlow(id: number, request: UpdateFlowRequest): Promise<Flow> {
  return invoke<Flow>("update_flow", { id, request });
}

export async function deleteFlow(id: number): Promise<void> {
  return invoke<void>("delete_flow", { id });
}

// --- Starting a flow (Phase 7.4) ---

export interface StartFlowRequest {
  title: string;
  target_type: string;
  target_id: number;
  /** A date within the anchor scope of the flow's kind (ISO "YYYY-MM-DD"). */
  anchor_date: string;
}

/** The materialized root of a started flow. */
export interface MaterializedFlow {
  root_type: "goal" | "task";
  root_id: number;
}

export async function startFlow(flowId: number, request: StartFlowRequest): Promise<MaterializedFlow> {
  return invoke<MaterializedFlow>("start_flow", { flowId, request });
}

// --- Target scope-validity & flow-origin lookup (Phase 7.5) ---

/** A candidate target node, referenced by kind and numeric id. */
export interface TargetRef {
  node_type: string;
  node_id: number;
}

/** A materialized node's originating flow (for the "from flow X" annotation). */
export interface FlowOrigin {
  node_type: string;
  node_id: number;
  flow_title: string;
}

/**
 * Returns the subset of `candidates` a flow of the given duration may validly target. With a
 * concrete `anchorDate` (ISO), containment is exact; with `null`, the coarse template-time check is
 * used. A `null` duration (Unscoped flow) accepts every candidate.
 */
export async function scopeValidFlowTargets(
  durationN: number | null,
  durationKind: string | null,
  anchorDate: string | null,
  candidates: TargetRef[],
): Promise<TargetRef[]> {
  return invoke<TargetRef[]>("scope_valid_flow_targets", { durationN, durationKind, anchorDate, candidates });
}

/** For each of `nodes` materialized from a flow, its originating flow title. */
export async function flowOrigins(nodes: TargetRef[]): Promise<FlowOrigin[]> {
  return invoke<FlowOrigin[]>("flow_origins", { nodes });
}

// --- Recurrence: a flow becomes a Habit (Phase 8.1) ---

export type ConsumptionKind = "destructive" | "accumulating";
export type BlockingMode = "overlapping" | "blocking";
export type CatchupPolicy = "all_pending" | "next" | "latest";

/** A Habit's Recurrence — Repetition (start/gap/end) plus the Consumption config. */
export interface FlowRecurrence {
  flow_id: number;
  start_scope_id: number;
  gap_n: number | null;
  gap_kind: string | null;
  end_scope_id: number | null;
  consumption_kind: ConsumptionKind;
  blocking_mode: BlockingMode | null;
  catchup_policy: CatchupPolicy | null;
}

export interface SetRecurrenceRequest {
  start_scope_id: number;
  gap_n?: number | null;
  gap_kind?: string | null;
  end_scope_id?: number | null;
  consumption_kind: ConsumptionKind;
  blocking_mode?: BlockingMode | null;
  catchup_policy?: CatchupPolicy | null;
}

/** Sets (creates or replaces) a flow's Recurrence, making it a Habit. */
export async function setFlowRecurrence(flowId: number, request: SetRecurrenceRequest): Promise<FlowRecurrence> {
  return invoke<FlowRecurrence>("set_flow_recurrence", { flowId, request });
}

/** Fetches a flow's Recurrence, or null if it is a plain (non-habit) flow. */
export async function getFlowRecurrence(flowId: number): Promise<FlowRecurrence | null> {
  return invoke<FlowRecurrence | null>("get_flow_recurrence", { flowId });
}

/** Deletes a flow's Recurrence, demoting the Habit back to a plain flow. */
export async function deleteFlowRecurrence(flowId: number): Promise<void> {
  return invoke<void>("delete_flow_recurrence", { flowId });
}

// --- Habit instance generation (Phase 8.2) ---

export type IterationStatus = "active" | "done" | "lapsed" | "missed";

/** A derived Habit iteration on a reference day (nothing is persisted per iteration). */
export interface HabitIteration {
  index: number;
  anchor_scope_id: number;
  /** The window's first day, ISO `YYYY-MM-DD`. */
  anchor_date: string;
  status: IterationStatus;
}

/**
 * Derives a Habit's iterations at `now` (local wall-clock, ISO `YYYY-MM-DDTHH:MM:SS`), classified
 * per its Consumption.
 */
export async function generateHabitIterations(flowId: number, now: string): Promise<HabitIteration[]> {
  return invoke<HabitIteration[]>("generate_habit_iterations", { flowId, now });
}

/**
 * Marks a Habit iteration (by its anchor scope) done or not-done, recording `resolvedAtMs` (epoch
 * ms) as the completion instant. Writes/clears `done` Modifications for every flow item.
 */
export async function setHabitIterationDone(
  flowId: number,
  iterationScopeId: number,
  done: boolean,
  resolvedAtMs: number,
): Promise<void> {
  return invoke<void>("set_habit_iteration_done", { flowId, iterationScopeId, done, resolvedAtMs });
}

/** Number of distinct completed iterations of a Habit (divergence check for reconciliation). */
export async function habitCompletionCount(flowId: number): Promise<number> {
  return invoke<number>("habit_completion_count", { flowId });
}

/** Clears every Habit Modification for a flow (delete-and-regenerate reconciliation). */
export async function clearHabitModifications(flowId: number): Promise<void> {
  return invoke<void>("clear_habit_modifications", { flowId });
}

/** Deep-clones a flow's template into a new flow (archive-and-new reconciliation). */
export async function forkFlow(flowId: number): Promise<Flow> {
  return invoke<Flow>("fork_flow", { flowId });
}

// --- Flow items (Phase 7.3) ---

/** Which flow-item table a row lives in. */
export type FlowItemType = "flow_goal" | "flow_task";

/** A flow-goal template item. */
export interface FlowGoal {
  id: number;
  flow_id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  position: number;
}

/** A flow-task template item. */
export interface FlowTask {
  id: number;
  flow_id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  position: number;
}

/** A relative (Cycle Scope, Cycle Plan) pair carried by a flow item. */
export interface FlowItemCycle {
  id: number;
  flow_id: number;
  item_type: FlowItemType;
  item_id: number;
  scope_kind: string | null;
  scope_index: number | null;
  plan_kind: string | null;
  plan_start: number | null;
  plan_end: number | null;
  position: number;
}

/** One (Cycle Scope, Cycle Plan) pair to persist. */
export interface FlowCycleInput {
  scope_kind: string | null;
  scope_index: number | null;
  plan_kind: string | null;
  plan_start: number | null;
  plan_end: number | null;
}

/** An intra-flow dependency: `dependent` waits on `depends_on`. */
export interface FlowDependency {
  id: number;
  flow_id: number;
  dependent_type: FlowItemType;
  dependent_id: number;
  depends_on_type: FlowItemType;
  depends_on_id: number;
}

export interface CreateFlowItemRequest {
  flow_id: number;
  title: string;
  parent_type: string;
  parent_id: number;
}

export interface UpdateFlowItemRequest {
  title?: string;
  parent_type?: string;
  parent_id?: number;
  position?: number;
}

export async function listAllFlowGoals(): Promise<FlowGoal[]> {
  return invoke<FlowGoal[]>("list_all_flow_goals");
}

export async function listAllFlowTasks(): Promise<FlowTask[]> {
  return invoke<FlowTask[]>("list_all_flow_tasks");
}

export async function listAllFlowCycles(): Promise<FlowItemCycle[]> {
  return invoke<FlowItemCycle[]>("list_all_flow_cycles");
}

export async function listAllFlowDependencies(): Promise<FlowDependency[]> {
  return invoke<FlowDependency[]>("list_all_flow_dependencies");
}

export async function createFlowGoal(request: CreateFlowItemRequest): Promise<FlowGoal> {
  return invoke<FlowGoal>("create_flow_goal", { request });
}

export async function createFlowTask(request: CreateFlowItemRequest): Promise<FlowTask> {
  return invoke<FlowTask>("create_flow_task", { request });
}

export async function updateFlowGoal(id: number, request: UpdateFlowItemRequest): Promise<FlowGoal> {
  return invoke<FlowGoal>("update_flow_goal", { id, request });
}

export async function updateFlowTask(id: number, request: UpdateFlowItemRequest): Promise<FlowTask> {
  return invoke<FlowTask>("update_flow_task", { id, request });
}

export async function deleteFlowItem(itemType: FlowItemType, id: number): Promise<void> {
  return invoke<void>("delete_flow_item", { itemType, id });
}

/** Converts a flow item to the other kind (goal↔task); returns the new item id. */
export async function convertFlowItem(fromType: FlowItemType, id: number, toType: FlowItemType): Promise<number> {
  return invoke<number>("convert_flow_item", { fromType, id, toType });
}

export async function setFlowItemCycles(flowId: number, itemType: FlowItemType, itemId: number, cycles: FlowCycleInput[]): Promise<void> {
  return invoke<void>("set_flow_item_cycles", { flowId, itemType, itemId, cycles });
}

export async function addFlowDependency(flowId: number, dependentType: FlowItemType, dependentId: number, dependsOnType: FlowItemType, dependsOnId: number): Promise<void> {
  return invoke<void>("add_flow_dependency", { flowId, dependentType, dependentId, dependsOnType, dependsOnId });
}

export async function removeFlowDependency(dependentType: FlowItemType, dependentId: number, dependsOnType: FlowItemType, dependsOnId: number): Promise<void> {
  return invoke<void>("remove_flow_dependency", { dependentType, dependentId, dependsOnType, dependsOnId });
}
