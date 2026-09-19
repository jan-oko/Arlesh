import { invoke } from "./gesture";

/**
 * What a Flow's root materializes as. `commitment` is how a repeating rule — a nightly
 * "asleep by 23:00" — recurs: through the Habit machinery that already exists rather than a
 * second recurrence engine, with each iteration's Verdict held as a Modification row.
 */
export type InstanceType = "goal" | "task" | "commitment";

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
  // Relative Cycle Plan for the root (task instance type only): plan kind + start/end offsets within
  // the flow window. All three set together, or all null (root unplanned).
  root_plan_kind: string | null;
  root_plan_start: number | null;
  root_plan_end: number | null;
  // The Verdict Window a commitment Habit's iterations are bounded by: how long past the end of an
  // iteration's own window its verdict may still be recorded, as the same (n, kind) Duration pair a
  // Commitment carries. Null leaves iterations answerable indefinitely. A virtual iteration has no
  // commitments row to carry one of its own, and the flow's target is usually a Project or Domain,
  // which carries none either — so the Habit is where it lives.
  verdict_window_n: number | null;
  verdict_window_kind: string | null;
  // Whether this flow is a Habit (has a Recurrence) — derived on read.
  is_habit: boolean;
  position: number;
  is_private: boolean;
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
  root_plan_kind?: string | null;
  root_plan_start?: number | null;
  root_plan_end?: number | null;
  verdict_window_n?: number | null;
  verdict_window_kind?: string | null;
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
  root_plan_kind?: string | null;
  root_plan_start?: number | null;
  root_plan_end?: number | null;
  verdict_window_n?: number | null;
  verdict_window_kind?: string | null;
  parent_type?: string;
  parent_id?: number;
  position?: number;
  is_private?: boolean;
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

/** Every real Goal/Task node materialized by a started flow (for the flow-instance badge). */
export async function listFlowInstanceNodes(): Promise<TargetRef[]> {
  return invoke<TargetRef[]>("list_flow_instance_nodes");
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

/** A derived Habit iteration's state. `expired` is a commitment Habit's only: its Verdict Window
 * ran out with no verdict recorded, so it archives still unresolved — never "missed", which would
 * be the app concluding an outcome nobody stated. */
export type IterationStatus = "active" | "done" | "lapsed" | "missed" | "expired";

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
 * A Habit iteration's completable instances: each flow item plus the flow **root** (`flow_root`),
 * which is an instance in its own right, not just an aggregate of its items.
 */
export type HabitInstanceType = FlowItemType | "flow_root";

/** An instance's divergent status for one Habit iteration (a non-tombstoned Modification). */
export interface HabitItemStatus {
  item_type: HabitInstanceType;
  item_id: number;
  iteration_scope_id: number;
  status: string;
}

/** Every instance with a divergent status, and the iteration scope it applies to. */
export async function listHabitItemStatuses(flowId: number): Promise<HabitItemStatus[]> {
  return invoke<HabitItemStatus[]>("list_habit_item_statuses", { flowId });
}

/**
 * Sets a single instance's status (a flow item, or the `flow_root` — with `itemId` = the flow id) at
 * one iteration scope. `status` `null` clears it (back to the base status: task `todo` / goal
 * `active`); `resolvedAtMs` is recorded for a `done` status. The iteration reads Done once the root
 * and every item are `done`.
 */
export async function setHabitItemStatus(
  flowId: number,
  itemType: HabitInstanceType,
  itemId: number,
  iterationScopeId: number,
  status: string | null,
  resolvedAtMs: number,
): Promise<void> {
  return invoke<void>("set_habit_item_status", { flowId, itemType, itemId, iterationScopeId, status, resolvedAtMs });
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

/**
 * Converts a real Task/Goal subtree into a Flow template of the same instance type. `keepDependencies`
 * remaps intra-subtree task dependencies; `mapScopes` translates the root's Time Scope to the flow
 * Window and descendants' scopes to relative cycle scopes. The original subtree is deleted.
 */
export async function convertToFlow(
  nodeType: string,
  nodeId: number,
  keepDependencies: boolean,
  mapScopes: boolean,
): Promise<Flow> {
  return invoke<Flow>("convert_to_flow", { nodeType, nodeId, keepDependencies, mapScopes });
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
  is_private: boolean;
}

/** A flow-task template item. */
export interface FlowTask {
  id: number;
  flow_id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  position: number;
  is_private: boolean;
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
  is_private?: boolean;
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
