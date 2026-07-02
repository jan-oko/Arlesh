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
  flow_duration_kind: string | null;
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
}

export interface UpdateFlowRequest {
  title?: string;
  instance_type?: InstanceType;
  // Absent = leave unchanged, null = clear, value = set.
  target_type?: string | null;
  target_id?: number | null;
  flow_duration_n?: number | null;
  flow_duration_kind?: string | null;
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
  status: string;
  blocked_reason: string | null;
  position: number;
}

/** A flow-task template item. */
export interface FlowTask {
  id: number;
  flow_id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  status: string;
  blocked_reason: string | null;
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
  status?: string;
  blocked_reason?: string | null;
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
export async function convertFlowItem(fromType: FlowItemType, id: number, toType: FlowItemType, status: string): Promise<number> {
  return invoke<number>("convert_flow_item", { fromType, id, toType, status });
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
