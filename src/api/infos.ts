import { invoke } from "./gesture";

export interface Info {
  id: number;
  body: string;
  details: string | null;
  parent_type: string;
  parent_id: number;
  position: number;
  is_private: boolean;
}

export interface CreateInfoRequest {
  body: string;
  details?: string | null;
  parent_type: string;
  parent_id: number;
  position: number;
}

export interface UpdateInfoRequest {
  body?: string;
  // Absent = leave unchanged, null = clear, value = set.
  details?: string | null;
  position?: number;
  parent_type?: string;
  parent_id?: number;
  is_private?: boolean;
}

export async function listInfos(): Promise<Info[]> {
  return invoke<Info[]>("list_infos");
}

export async function createInfo(request: CreateInfoRequest): Promise<Info> {
  return invoke<Info>("create_info", { request });
}

export async function updateInfo(id: number, request: UpdateInfoRequest): Promise<Info> {
  return invoke<Info>("update_info", { id, request });
}

export async function deleteInfo(id: number): Promise<void> {
  return invoke<void>("delete_info", { id });
}

export async function duplicateInfo(
  id: number,
  targetType: string,
  targetId: number,
  position: number,
): Promise<Info> {
  return invoke<Info>("duplicate_info", { id, targetType, targetId, position });
}
