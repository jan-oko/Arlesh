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
