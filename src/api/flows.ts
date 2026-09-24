import { invoke } from "./gesture";
import { isWireError } from "@/api/errors";
import type { ScopeKey } from "@/api/scopes";
import type { Delegate, TaskAgentic, TaskArchival } from "@/api/tasks";

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
  // Commitment carries. Null leaves iterations answerable indefinitely. Each iteration's Commitment row
  // reads it from here, and the flow's target is usually a Project or Domain, which carries none
  // — so the Habit is where it lives.
  verdict_window_n: number | null;
  verdict_window_kind: string | null;
  // Whether this flow is a Habit (has a Recurrence) — derived on read.
  is_habit: boolean;
  position: number;
  is_private: boolean;
  // The root template's own fields: a task-instance flow's Task columns, every flow's tags and
  // block reasons (migration 0061). An iteration root inherits them.
  delegate_to?: Delegate | null;
  agentic?: boolean | null;
  asynchronous?: boolean;
  archival?: TaskArchival;
  beads_id?: string;
  tag_ids?: number[];
  block_reasons?: string[];
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
  start_scope_id: ScopeKey;
  gap_n: number | null;
  gap_kind: string | null;
  end_scope_id: ScopeKey | null;
  consumption_kind: ConsumptionKind;
  blocking_mode: BlockingMode | null;
  catchup_policy: CatchupPolicy | null;
}

export interface SetRecurrenceRequest {
  start_scope_id: ScopeKey;
  gap_n?: number | null;
  gap_kind?: string | null;
  end_scope_id?: ScopeKey | null;
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

// --- Habit occurrences ---
//
// A Habit's occurrences are ordinary Task, Goal and Commitment rows with a `habit` origin
// (ADR 0008). They are read, written, parented and deleted through the ordinary commands; what
// remains here is what is genuinely about the Habit as a whole.

/**
 * The `cycle_id` of an occurrence that came from no cycle pair — an item that declares none, and
 * the flow root, which never has any.
 */
export const NO_CYCLE = 0;

/** What a node hung on a Habit occurrence can be: anything a Task can parent. */
export type HabitChildKind = "task" | "goal" | "commitment" | "info" | "expectation";

/** An added child that is not finished, as the completion guard names it. */
export interface UnfinishedChild {
  child_type: HabitChildKind;
  child_id: number;
  title: string;
}

function isUnfinishedChild(value: unknown): value is UnfinishedChild {
  if (typeof value !== "object" || value === null) return false;
  if (!("child_type" in value) || !("child_id" in value) || !("title" in value)) return false;
  return (
    typeof value.child_type === "string" &&
    typeof value.child_id === "number" &&
    typeof value.title === "string"
  );
}

/**
 * Narrows a rejection to the refusal marking an occurrence done raises while it still holds
 * unfinished added children.
 *
 * Returns them, named, so the prompt can say what is about to be closed over — a confirmation the
 * user can only accept blind is not consent. `null` for any other rejection, which the caller must
 * surface as a real failure rather than as a question.
 */
export function unfinishedChildren(error: unknown): UnfinishedChild[] | null {
  if (!isWireError(error) || error.kind !== "needs_confirmation") return null;
  const { details } = error;
  if (typeof details !== "object" || details === null) return null;
  if (!("children" in details)) return null;
  const { children } = details;
  if (!Array.isArray(children) || !children.every(isUnfinishedChild)) return null;
  return children;
}

/** Number of distinct completed iterations of a Habit (divergence check for reconciliation). */
export async function habitCompletionCount(flowId: number): Promise<number> {
  return invoke<number>("habit_completion_count", { flowId });
}

/** Clears every Habit Modification for a flow (delete-and-regenerate reconciliation). */
export async function clearHabitModifications(flowId: number): Promise<void> {
  return invoke<void>("clear_habit_modifications", { flowId });
}

/**
 * The archive-and-new reconciliation: deep-clones a flow's template into a new flow and archives
 * the original Habit — it stops recurring after the Day holding `now` (a local wall-clock
 * `YYYY-MM-DDTHH:MM:SS`), keeping the iterations that had begun — in one backend transaction.
 */
export async function forkFlow(flowId: number, now: string): Promise<Flow> {
  return invoke<Flow>("fork_flow", { flowId, now });
}

/**
 * Copies a Flow under a new parent: the template, its cycle pairs and intra-flow dependencies, its
 * Recurrence (so a copy of a Habit is a Habit, on the same schedule from the same anchor) and its
 * privacy. No completion history and no started instances come with it.
 */
export async function duplicateFlow(
  flowId: number,
  parentType: string,
  parentId: number,
  position: number,
): Promise<Flow> {
  return invoke<Flow>("duplicate_flow", { flowId, parentType, parentId, position });
}

/**
 * Copies a flow item, and everything nested under it, within its own template — cycle pairs
 * included. Returns the new item's id. Refused across flows, where the Cycle Scope offset would
 * have to be resolved against a window it was never measured in.
 */
export async function duplicateFlowItem(
  itemType: FlowItemType,
  itemId: number,
  parentType: string,
  parentId: number,
  position: number,
): Promise<number> {
  return invoke<number>("duplicate_flow_item", { itemType, itemId, parentType, parentId, position });
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

/**
 * What a template row says about the rows it draws beyond its title and place: its kind's columns
 * and relations. A Habit's occurrences inherit each field until they say otherwise; a started
 * flow's copy carries them. The Task-only fields are meaningful on a task template alone.
 */
export interface TemplateFields {
  delegate_to?: Delegate | null;
  agentic?: boolean | null;
  asynchronous?: boolean;
  archival?: TaskArchival;
  beads_id?: string;
  tag_ids?: number[];
  block_reasons?: string[];
}

/** A change to a template row's own columns and relations; each field absent stays as it is. */
export interface TemplateUpdate {
  delegate_to?: Delegate | null;
  agentic?: TaskAgentic;
  asynchronous?: boolean;
  archival?: TaskArchival;
  tag_ids?: number[];
  block_reasons?: string[];
}

/** A flow-goal template item. */
export interface FlowGoal extends TemplateFields {
  id: number;
  flow_id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  position: number;
  is_private: boolean;
}

/** A flow-task template item. */
export interface FlowTask extends TemplateFields {
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

export interface UpdateFlowItemRequest extends TemplateUpdate {
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

/** How a cycle edit that would orphan what an occurrence recorded is answered. */
export type CycleReconcile = "fork" | "discard";

/** The fork an Archive & new item edit landed on, with the old→new item ids. */
export interface ForkedTemplate {
  flow_id: number;
  goals: [number, number][];
  tasks: [number, number][];
}

/**
 * Saves an item's cycle pairs, keeping every pair that survives. A change that would orphan what
 * an occurrence recorded is refused with `needs_confirmation` until `reconcile` answers it —
 * Archive & new (with `now`) or Discard & regenerate.
 */
export async function setFlowItemCycles(
  flowId: number,
  itemType: FlowItemType,
  itemId: number,
  cycles: FlowCycleInput[],
  reconcile?: CycleReconcile,
  now?: string,
): Promise<ForkedTemplate | null> {
  return invoke<ForkedTemplate | null>("set_flow_item_cycles", {
    flowId, itemType, itemId, cycles, reconcile, now,
  });
}

/**
 * How many iterations a refused cycle edit would orphan the recorded edits of, when `error` is that
 * refusal; `null` for any other error.
 */
export function orphanedEditCount(error: unknown): number | null {
  if (!isWireError(error) || error.kind !== "needs_confirmation") return null;
  const details: unknown = error.details;
  if (typeof details !== "object" || details === null) return null;
  if (!("reason" in details) || details.reason !== "orphaned_edits") return null;
  return "iterations" in details && typeof details.iterations === "number" ? details.iterations : null;
}

export async function addFlowDependency(flowId: number, dependentType: FlowItemType, dependentId: number, dependsOnType: FlowItemType, dependsOnId: number): Promise<void> {
  return invoke<void>("add_flow_dependency", { flowId, dependentType, dependentId, dependsOnType, dependsOnId });
}

export async function removeFlowDependency(dependentType: FlowItemType, dependentId: number, dependsOnType: FlowItemType, dependsOnId: number): Promise<void> {
  return invoke<void>("remove_flow_dependency", { dependentType, dependentId, dependsOnType, dependsOnId });
}
